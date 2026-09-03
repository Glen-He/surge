import type { Migration } from "./index";


// ── v14：不可变报告版本 + 跨实例上传租约──
// storage_key 指向用户目录下不可变的 artifacts/<key>。替换文件时先发布
// 新目录，再用一次 UPDATE 切换数据库指针；无论进程在哪一步崩溃，旧
// capability 都不会读取到新字节。v14 曾为数据转正暂时允许 NULL，
// v21/v22 已将内容来源收紧为严格二选一。
export const IMMUTABLE_REPORT_STORAGE: Migration = {
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
