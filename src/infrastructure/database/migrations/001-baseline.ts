import type { Migration } from "./migration";


export const BASELINE: Migration = {
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
    // 标签颜色（7 色板之一，见 features/reports/tag-colors.ts；旧行为空时前端按标签哈希兜底）
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
