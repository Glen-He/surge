import { db } from "./db";

// 业务表自动创建（幂等，任何环境启动都会保证存在）
//
// 注意：旧 security_logs 表可能已经存在但没有 email 列（之前只用 action 字段）。
// CREATE TABLE IF NOT EXISTS 对已存在的表不会补列，所以必须用 ALTER 显式补列，
// 否则依赖 email 列的频控查询会报 "column does not exist"。
export async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS reports (
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
    );
  `);

  // 卡片手动排序（拖拽调序）；旧数据按日期倒序回填
  await db.query(
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS sort_order INTEGER`,
  );
  await db.query(`
    UPDATE reports SET sort_order = sub.rn
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id ORDER BY date DESC, created_at DESC
             ) AS rn
      FROM reports
      WHERE sort_order IS NULL
    ) sub
    WHERE reports.id = sub.id
  `);

  // 账户安全事件日志（变更凭证 / 审计 / OTP 频控）
  await db.query(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT REFERENCES "user"(id) ON DELETE SET NULL,
      action      TEXT NOT NULL,
      email       TEXT,
      ip        TEXT,
      user_agent  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // 给已存在的旧表补 email 列（CREATE TABLE IF NOT EXISTS 不会补列）
  await db.query(
    `ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS email TEXT`,
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS security_logs_email_time
      ON security_logs (email, created_at)`,
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS security_logs_action_time
      ON security_logs (action, created_at)`,
  );

  // 一次性安全 token（email_change / password_change / otp_verification）
  await db.query(`
    CREATE TABLE IF NOT EXISTS account_changes (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      type         TEXT NOT NULL,
      target       TEXT,
      payload      JSONB,
      expires_at   TIMESTAMPTZ NOT NULL,
      consumed     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS account_changes_user_type
      ON account_changes (user_id, type, expires_at)`,
  );

  // 自管 OTP 存储（统一尝试次数 / 过期 / 一次性）
  await db.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      purpose    TEXT NOT NULL,
      code       TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS otp_codes_email_purpose
      ON otp_codes (email, purpose)`,
  );

  // user 表增加并发版本号（多设备修改邮箱安全）
  await db.query(
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`,
  );

  // 账号删除冷却期：非 NULL 表示已申请删除，+15 天到期后物理清除
  await db.query(
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ`,
  );

  // 邮箱唯一约束（better-auth 默认 email 唯一，这里显式保证）
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique
      ON "user" (email)`,
  );

  // 访客沙箱元信息（30 分钟过期、登出即销毁；过期用户由懒清理任务级联删除）
  await db.query(`
    CREATE TABLE IF NOT EXISTS guest_sessions (
      user_id     TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS guest_sessions_expires
      ON guest_sessions (expires_at)`,
  );

  // 报告只读分享链接：token 高熵不可枚举，密码可选（scrypt），
  // 有效期可选，撤销 = revoked_at 置时间；删除报告级联清理
  await db.query(`
    CREATE TABLE IF NOT EXISTS report_shares (
      id            TEXT PRIMARY KEY,
      report_id     TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      token         TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      expires_at    TIMESTAMPTZ,
      revoked_at    TIMESTAMPTZ,
      view_count    BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS report_shares_report
      ON report_shares (report_id)`,
  );
}

// 兜底迁移：在每个 OTP 相关接口入口调用，确保即便服务器没重启，
// 缺失的表 / 列也会被自动补齐（otp_codes、account_changes、version、email 等）。
// 所有语句都是 IF NOT EXISTS 幂等的，重复调用安全。
// 用 try/catch 包裹避免权限不足或异常时影响主流程。
let migrated = false;
let migrating: Promise<void> | null = null;

export function ensureOtpMigration(): Promise<void> {
  if (migrated) return Promise.resolve();
  if (migrating) return migrating;
  migrating = (async () => {
    try {
      // 完整执行建表逻辑（幂等），一次性补齐所有缺失结构
      await ensureSchema();
      migrated = true;
    } catch (err) {
      console.error("[ensureOtpMigration]", err);
    } finally {
      migrating = null;
    }
  })();
  return migrating;
}
