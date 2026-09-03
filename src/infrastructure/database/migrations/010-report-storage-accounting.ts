import type { Migration } from "./migration";


// ── v10：报告存储字节记账 + 日期数据库约束 ──
// size_bytes 让每次上传无需递归扫描整个持久卷。v10 为既有行暂设 0，
// v22 在数据转正后要求私有 artifact 的记账必须为正数。日期约束
// NOT VALID 避免当时的数据阻塞发布，但会立即拒绝之后的非法写入。
export const REPORT_STORAGE_ACCOUNTING: Migration = {
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
