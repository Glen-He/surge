import { db } from "./db";
import { logger } from "./logger";

// 版本化数据库迁移：
// - schema_migrations 表记录已应用版本；每个版本在事务内执行并登记，只跑一次
// - 版本 1 为基线（全部 IF NOT EXISTS 幂等语句）：存量库执行时无副作用、仅登记
//   版本；全新库则一次建齐。此后结构变更一律追加新版本，不再依赖幂等重放
// - pg_advisory_lock 防止多实例并发迁移（同库多进程同时启动的场景）
//
// 新增迁移示例：
//   MIGRATIONS.push({ version: 2, name: "add-xxx", statements: ["ALTER TABLE …"] });

type Migration = { version: number; name: string; statements: string[] };

const BASELINE: Migration = {
  version: 1,
  name: "baseline",
  statements: [
    // ── reports ──
    `CREATE TABLE IF NOT EXISTS reports (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      slug        TEXT NOT NULL,
      title       TEXT NOT NULL,
      date        TEXT NOT NULL,
      tag         TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      keywords    TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, slug)
    )`,
    // 卡片手动排序（拖拽调序）；旧数据按日期倒序回填
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS sort_order INTEGER`,
    // 标签颜色（7 色板之一，见 lib/tag-colors.ts；旧行为空时前端按标签哈希兜底）
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS tag_color TEXT`,
    `UPDATE reports SET sort_order = sub.rn
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id ORDER BY date DESC, created_at DESC
               ) AS rn
        FROM reports
        WHERE sort_order IS NULL
      ) sub
      WHERE reports.id = sub.id`,
    // ── security_logs（账户安全事件：变更凭证 / 审计 / OTP 频控）──
    `CREATE TABLE IF NOT EXISTS security_logs (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT REFERENCES "user"(id) ON DELETE SET NULL,
      action      TEXT NOT NULL,
      email       TEXT,
      ip          TEXT,
      user_agent  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // 给已存在的旧表补 email 列（CREATE TABLE IF NOT EXISTS 不会补列）
    `ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS email TEXT`,
    `CREATE INDEX IF NOT EXISTS security_logs_email_time
      ON security_logs (email, created_at)`,
    `CREATE INDEX IF NOT EXISTS security_logs_action_time
      ON security_logs (action, created_at)`,
    // ── account_changes（一次性安全 token：email_change / password_change / otp_verification）──
    `CREATE TABLE IF NOT EXISTS account_changes (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      type         TEXT NOT NULL,
      target       TEXT,
      payload      JSONB,
      expires_at   TIMESTAMPTZ NOT NULL,
      consumed     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS account_changes_user_type
      ON account_changes (user_id, type, expires_at)`,
    // ── otp_codes（自管 OTP：统一尝试次数 / 过期 / 一次性）──
    `CREATE TABLE IF NOT EXISTS otp_codes (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      purpose    TEXT NOT NULL,
      code       TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS otp_codes_email_purpose
      ON otp_codes (email, purpose)`,
    // ── user 表增量列 ──
    // 并发版本号（多设备修改邮箱安全）
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`,
    // 账号删除冷却期：非 NULL 表示已申请删除，+15 天到期后物理清除
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ`,
    // 邮箱唯一约束（better-auth 默认 email 唯一，这里显式保证）
    `CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique
      ON "user" (email)`,
    // ── guest_sessions（访客沙箱元信息：60 分钟过期、登出即销毁）──
    `CREATE TABLE IF NOT EXISTS guest_sessions (
      user_id     TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS guest_sessions_expires
      ON guest_sessions (expires_at)`,
    // ── report_shares（报告只读分享：token 高熵不可枚举，密码 scrypt，删除报告级联清理）──
    `CREATE TABLE IF NOT EXISTS report_shares (
      id            TEXT PRIMARY KEY,
      report_id     TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      token         TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      expires_at    TIMESTAMPTZ,
      revoked_at    TIMESTAMPTZ,
      view_count    BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS report_shares_report
      ON report_shares (report_id)`,
  ],
};

// ── v2：api_tokens（程序化上传 API 的个人访问令牌）──
// 令牌明文仅创建瞬间展示一次，库里只存 scrypt 哈希；
// 撤销用 revoked_at 软删除；last_used_at 供用户在设置页查看
const API_TOKENS: Migration = {
  version: 2,
  name: "api-tokens",
  statements: [
    `CREATE TABLE IF NOT EXISTS api_tokens (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      name         TEXT NOT NULL DEFAULT '',
      token_hash   TEXT NOT NULL UNIQUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at   TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS api_tokens_user
      ON api_tokens (user_id) WHERE revoked_at IS NULL`,
  ],
};

const MIGRATIONS: Migration[] = [BASELINE, API_TOKENS];

// ── v3：令牌改为可再次查看（AES-GCM 加密存储）──
// token_hash 是单向 scrypt，无法还原明文 → 加 token_enc 列存密文；
// 存量哈希令牌（本功能刚上线，仅测试数据）直接作废
const API_TOKEN_ENC: Migration = {
  version: 3,
  name: "api-token-enc",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `UPDATE api_tokens SET token_enc = '', revoked_at = NOW()
      WHERE token_enc IS NULL`,
    `ALTER TABLE api_tokens ALTER COLUMN token_enc SET NOT NULL`,
  ],
};

MIGRATIONS.push(API_TOKEN_ENC);

// ── v4：删除废弃的 token_hash 列（v2 遗留，NOT NULL + UNIQUE，
// 与空串占位冲突且已无用途——令牌改存 token_enc）──
const API_TOKEN_DROP_HASH: Migration = {
  version: 4,
  name: "api-token-drop-hash",
  statements: [`ALTER TABLE api_tokens DROP COLUMN IF EXISTS token_hash`],
};

MIGRATIONS.push(API_TOKEN_DROP_HASH);

// 专用 advisory lock key（0x53555247 = "SURG"），避免与其他应用碰撞
const ADVISORY_LOCK_KEY = 0x53555247;

let ran: Promise<void> | null = null;

async function run(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INT PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const { rows } = await client.query<{ version: number }>(
      "SELECT version FROM schema_migrations",
    );
    const done = new Set(rows.map((r) => r.version));

    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await client.query("BEGIN");
      try {
        for (const sql of m.statements) await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [m.version, m.name],
        );
        await client.query("COMMIT");
        logger.info("migrations", `已应用 v${m.version} ${m.name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
}

/** 确保迁移已全部应用（进程内单次；失败可重试）。 */
export function ensureSchemaVersioned(): Promise<void> {
  if (!ran) {
    ran = run().catch((err) => {
      ran = null; // 失败不缓存，下次调用重试
      throw err;
    });
  }
  return ran;
}
