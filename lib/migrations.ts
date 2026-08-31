import { createHash } from "node:crypto";
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
    // ── guest_sessions（游客沙箱元信息：60 分钟过期、登出即销毁）──
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

// ── v5：报告内容世代（report capability 架构）──
// 一个报告只保留一份当前文件目录；revision_id 是该内容世代的标识，
// 每次替换文件时轮换。capability（/r/<cap>/ 虚拟目录的访问凭证）绑定
// reportId + revisionId，报告更新后旧 capability 整体失效（404），
// 不保存任何历史版本。存量行回填随机值即可（旧 capability 不存在）。
const REPORT_REVISION: Migration = {
  version: 5,
  name: "report-revision",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS revision_id TEXT`,
    `UPDATE reports SET revision_id = md5(random()::text || id)
      WHERE revision_id IS NULL`,
    `ALTER TABLE reports ALTER COLUMN revision_id SET NOT NULL`,
  ],
};

MIGRATIONS.push(REPORT_REVISION);

// ── v6：报告 capability 纪元（撤销语义）──
// capability 只绑 reportId+revisionId 时，撤销分享后已签发的 capability
// 在 TTL 内仍有效（权限在父页签发时裁决，runtime 无法追溯）。epoch 是
// 报告级吊销开关：撤销分享等权限变化时 +1，runtime 要求 cap.epoch 与
// DB 当前值一致，旧 capability 立即整体失效（副作用：该报告所有 cap
// 失效，刷新父页即重新签发，属可接受的简单化）。
const REPORT_CAP_EPOCH: Migration = {
  version: 6,
  name: "report-capability-epoch",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS capability_epoch
       INTEGER NOT NULL DEFAULT 0`,
  ],
};

MIGRATIONS.push(REPORT_CAP_EPOCH);

// ── v7：API 令牌可索引指纹 ──
// 认证不再加载并解密全部令牌；token_lookup 是高熵令牌的
// SHA-256 指纹，只用于等值定位。旧版本会在销毁密文前完成回填。
const API_TOKEN_LOOKUP: Migration = {
  version: 7,
  name: "api-token-lookup",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_lookup TEXT`,
    // Older builds intended one active token but enforced it with count-then-
    // insert. Repair any race-created duplicates before adding the DB invariant.
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY user_id ORDER BY created_at DESC, id DESC
              ) AS rn
       FROM api_tokens
       WHERE revoked_at IS NULL
     )
     UPDATE api_tokens t SET revoked_at = NOW()
     FROM ranked r WHERE t.id = r.id AND r.rn > 1`,
    `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_lookup_active
       ON api_tokens (token_lookup) WHERE revoked_at IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_one_active_per_user
       ON api_tokens (user_id) WHERE revoked_at IS NULL`,
  ],
};

MIGRATIONS.push(API_TOKEN_LOOKUP);

// ── v8：OTP 脱敏存储 ──
// 6 位码不得明文落库。存量 OTP 最长仅 5 分钟，部署时直接作废，
// 避免在迁移中需要短暂接触明文或依赖应用密钥。
const OTP_HASH: Migration = {
  version: 8,
  name: "otp-hash",
  statements: [
    `ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_hash TEXT`,
    `DELETE FROM otp_codes`,
    `ALTER TABLE otp_codes ALTER COLUMN code_hash SET NOT NULL`,
    `ALTER TABLE otp_codes DROP COLUMN IF EXISTS code`,
  ],
};

MIGRATIONS.push(OTP_HASH);

// ── v9：多实例共享的安全失败限流 ──
const SECURITY_RATE_LIMITS: Migration = {
  version: 9,
  name: "security-rate-limits",
  statements: [
    `CREATE TABLE IF NOT EXISTS security_rate_limits (
       key        TEXT PRIMARY KEY,
       attempts   INTEGER NOT NULL,
       reset_at   TIMESTAMPTZ NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS security_rate_limits_reset
       ON security_rate_limits (reset_at)`,
  ],
};

MIGRATIONS.push(SECURITY_RATE_LIMITS);

// ── v10：报告存储字节记账 + 日期数据库约束 ──
// size_bytes 让每次上传无需递归扫描整个持久卷。旧数据由启动回填
// 任务从文件系统校准。日期约束 NOT VALID 避免历史脏数据阻塞发布，
// 但会立即拒绝之后的非法写入；应用层同时做严格日历校验。
const REPORT_STORAGE_ACCOUNTING: Migration = {
  version: 10,
  name: "report-storage-accounting",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_date_iso`,
    `ALTER TABLE reports ADD CONSTRAINT reports_date_iso
       CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND date::date IS NOT NULL) NOT VALID`,
    `CREATE INDEX IF NOT EXISTS reports_user_size ON reports (user_id) INCLUDE (size_bytes)`,
  ],
};

MIGRATIONS.push(REPORT_STORAGE_ACCOUNTING);

// ── v11：API 令牌恢复为只展示一次──
// token_lookup 本身是对 256-bit 随机令牌的 SHA-256 指纹，足以认证。
// 销毁可解密密文，避免数据库 + 应用密钥同时泄露时恢复所有 PAT。
const API_TOKEN_HASH_ONLY: Migration = {
  version: 11,
  name: "api-token-hash-only",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_prefix TEXT NOT NULL DEFAULT 'sgk_'`,
    // A deployment that jumps directly from v6 to this version has no safe
    // lookup for its legacy encrypted token. Revoke it before destroying the
    // ciphertext instead of leaving a misleading but unusable active token.
    `UPDATE api_tokens SET revoked_at = NOW()
       WHERE revoked_at IS NULL AND token_lookup IS NULL`,
    `ALTER TABLE api_tokens DROP COLUMN IF EXISTS token_enc`,
  ],
};

MIGRATIONS.push(API_TOKEN_HASH_ONLY);

// ── v12：多分享面板──
// 一个用户可针对不同查看对象创建多个面板；同一报告可加入多个面板。
// 面板 token 是公开入口，item id 是面板内报告的非业务标识，避免暴露报告 slug。
const SHARE_BOARDS: Migration = {
  version: 12,
  name: "share-boards",
  statements: [
    `CREATE TABLE IF NOT EXISTS share_boards (
       id            TEXT PRIMARY KEY,
       user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
       token         TEXT NOT NULL UNIQUE,
       title         TEXT NOT NULL,
       password_hash TEXT,
       disabled_at   TIMESTAMPTZ,
       view_count    BIGINT NOT NULL DEFAULT 0,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS share_boards_user
       ON share_boards (user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS share_board_items (
       id         TEXT PRIMARY KEY,
       board_id   TEXT NOT NULL REFERENCES share_boards(id) ON DELETE CASCADE,
       report_id  TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (board_id, report_id)
     )`,
    `CREATE INDEX IF NOT EXISTS share_board_items_board
       ON share_board_items (board_id)`,
    `CREATE INDEX IF NOT EXISTS share_board_items_report
       ON share_board_items (report_id)`,
  ],
};

MIGRATIONS.push(SHARE_BOARDS);

// ── v13：游客示例改为共享只读模板引用 ──
// template_key 为 NULL 时，报告内容位于用户独立目录；非 NULL 时，
// 只能由服务端映射到代码库内的允许列表模板。模板字节只存一份，
// 游客的标题、排序、revision 等仍是独立数据库记录。替换文件时
// 应用将 template_key 清空，自动转为用户私有副本（copy-on-write）。
const REPORT_TEMPLATE_REFERENCE: Migration = {
  version: 13,
  name: "report-template-reference",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS template_key TEXT`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_template_key_safe`,
    `ALTER TABLE reports ADD CONSTRAINT reports_template_key_safe
       CHECK (template_key IS NULL OR template_key ~ '^tpl-[0-9]{2}$')`,
    `CREATE INDEX IF NOT EXISTS reports_template_key
       ON reports (template_key) WHERE template_key IS NOT NULL`,
  ],
};

MIGRATIONS.push(REPORT_TEMPLATE_REFERENCE);

// ── v14：不可变报告版本 + 跨实例上传租约──
// storage_key 指向用户目录下不可变的 artifacts/<key>。替换文件时先发布
// 新目录，再用一次 UPDATE 切换数据库指针；无论进程在哪一步崩溃，旧
// capability 都不会读取到新字节。NULL 保留给共享模板和旧版 slug 目录，
// 由后台清理任务渐进回收，不需要停机搬迁历史文件。
const IMMUTABLE_REPORT_STORAGE: Migration = {
  version: 14,
  name: "immutable-report-storage",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS storage_key TEXT`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_storage_key_safe`,
    `ALTER TABLE reports ADD CONSTRAINT reports_storage_key_safe
       CHECK (storage_key IS NULL OR storage_key ~ '^a_[0-9a-f]{32}$')`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reports_storage_key_unique
       ON reports (user_id, storage_key) WHERE storage_key IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS upload_leases (
       slot_id    INTEGER PRIMARY KEY,
       holder     TEXT NOT NULL UNIQUE,
       expires_at TIMESTAMPTZ NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS upload_leases_expiry
       ON upload_leases (expires_at)`,
  ],
};

MIGRATIONS.push(IMMUTABLE_REPORT_STORAGE);

// ── v15：生命周期清理索引──
// 后台按过期时间小批量删除，索引避免数据增长后维护任务扫描整表。
const RETENTION_CLEANUP_INDEXES: Migration = {
  version: 15,
  name: "retention-cleanup-indexes",
  statements: [
    `CREATE INDEX IF NOT EXISTS security_logs_created_at
       ON security_logs (created_at)`,
    `CREATE INDEX IF NOT EXISTS otp_codes_expires_at
       ON otp_codes (expires_at)`,
    `CREATE INDEX IF NOT EXISTS account_changes_expires_at
       ON account_changes (expires_at)`,
    `CREATE INDEX IF NOT EXISTS verification_expires_at
       ON verification ("expiresAt")`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_one_content_source`,
    `ALTER TABLE reports ADD CONSTRAINT reports_one_content_source
       CHECK (template_key IS NULL OR storage_key IS NULL)`,
  ],
};

MIGRATIONS.push(RETENTION_CLEANUP_INDEXES);

const SHARE_CREDENTIAL_HARDENING: Migration = {
  version: 16,
  name: "share-credential-hardening",
  statements: [
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS token_hash TEXT`,
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `ALTER TABLE report_shares ALTER COLUMN token DROP NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS report_shares_token_hash_unique
       ON report_shares (token_hash) WHERE token_hash IS NOT NULL`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS token_hash TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS access_epoch INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE share_boards ALTER COLUMN token DROP NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS share_boards_token_hash_unique
       ON share_boards (token_hash) WHERE token_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS share_boards_expires_at
       ON share_boards (expires_at) WHERE expires_at IS NOT NULL`,
  ],
};

MIGRATIONS.push(SHARE_CREDENTIAL_HARDENING);

const MAINTENANCE_STATE: Migration = {
  version: 17,
  name: "maintenance-state",
  statements: [
    `CREATE TABLE IF NOT EXISTS maintenance_state (
       name TEXT PRIMARY KEY,
       last_started_at TIMESTAMPTZ,
       last_succeeded_at TIMESTAMPTZ,
       last_error TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ],
};

MIGRATIONS.push(MAINTENANCE_STATE);

const REPORT_PRIVACY_MODE: Migration = {
  version: 18,
  name: "report-privacy-mode",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS external_network_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  ],
};

MIGRATIONS.push(REPORT_PRIVACY_MODE);

// ── v19：新报告外部网络安全默认值──
// v18 以 TRUE 回填存量报告，避免升级后页面突然断网。
// 本迁移只改之后新行的 DB 默认值，存量值保持不变。
const REPORT_PRIVACY_DEFAULT: Migration = {
  version: 19,
  name: "report-privacy-default",
  statements: [
    `ALTER TABLE reports ALTER COLUMN external_network_enabled SET DEFAULT FALSE`,
  ],
};

MIGRATIONS.push(REPORT_PRIVACY_DEFAULT);

// ── v20：可再次复制的 4 位分享提取码──
// 验证仍使用 scrypt 哈希；密文只供属主重新复制“链接 + 提取码”，
// 且与分享 token 使用不同的派生密钥。旧长密码保持 hash-only 兼容。
const SHARE_PASSCODE_RECOVERY: Migration = {
  version: 20,
  name: "share-passcode-recovery",
  statements: [
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS password_enc TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS password_enc TEXT`,
  ],
};

MIGRATIONS.push(SHARE_PASSCODE_RECOVERY);

// 专用 advisory lock key（0x53555247 = "SURG"），避免与其他应用碰撞
const ADVISORY_LOCK_KEY = 0x53555247;

let ran: Promise<void> | null = null;

async function run(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const { rows } = await client.query<{ version: number; name: string; checksum: string | null }>(
      "SELECT version, name, checksum FROM schema_migrations",
    );
    const done = new Map(rows.map((r) => [r.version, r]));

    for (const m of MIGRATIONS) {
      const checksum = createHash("sha256")
        .update(m.name)
        .update("\0")
        .update(m.statements.join("\0"))
        .digest("hex");
      const existing = done.get(m.version);
      if (existing) {
        if (existing.name !== m.name) {
          throw new Error(`迁移 v${m.version} 名称已发生变化`);
        }
        if (existing.checksum && existing.checksum !== checksum) {
          throw new Error(`迁移 v${m.version} 内容已被修改；已应用迁移必须保持不可变`);
        }
        if (!existing.checksum) {
          await client.query(
            "UPDATE schema_migrations SET checksum = $2 WHERE version = $1 AND checksum IS NULL",
            [m.version, checksum],
          );
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        for (const sql of m.statements) await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [m.version, m.name, checksum],
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
