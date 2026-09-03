import type { Migration } from "./migration";


// ── v9：多实例共享的安全失败限流 ──
export const SECURITY_RATE_LIMITS: Migration = {
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
