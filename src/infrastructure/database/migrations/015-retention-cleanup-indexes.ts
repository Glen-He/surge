import type { Migration } from "./index";


// ── v15：生命周期清理索引──
// 后台按过期时间小批量删除，索引避免数据增长后维护任务扫描整表。
export const RETENTION_CLEANUP_INDEXES: Migration = {
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
