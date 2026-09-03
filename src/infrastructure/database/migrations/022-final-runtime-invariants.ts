import type { Migration } from "./migration";


// ── v22：收紧最终运行时不变量──
// 生产数据完成转正后，不再保留明文 token 列、请求期加固任务或零字节
// 报告回填。迁移先验证数据完整性，异常时整体回滚并拒绝实例启动。
export const FINAL_RUNTIME_INVARIANTS: Migration = {
  version: 22,
  name: "final-runtime-invariants",
  statements: [
    `ALTER TABLE reports VALIDATE CONSTRAINT reports_exactly_one_content_source`,
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM report_shares
         WHERE token IS NOT NULL OR token_hash IS NULL OR token_enc IS NULL
       ) THEN
         RAISE EXCEPTION 'report share token migration is incomplete';
       END IF;
       IF EXISTS (
         SELECT 1 FROM share_boards
         WHERE token IS NOT NULL OR token_hash IS NULL OR token_enc IS NULL
       ) THEN
         RAISE EXCEPTION 'share board token migration is incomplete';
       END IF;
     END $$`,
    `ALTER TABLE report_shares ALTER COLUMN token_hash SET NOT NULL`,
    `ALTER TABLE report_shares ALTER COLUMN token_enc SET NOT NULL`,
    `ALTER TABLE report_shares DROP COLUMN token`,
    `ALTER TABLE share_boards ALTER COLUMN token_hash SET NOT NULL`,
    `ALTER TABLE share_boards ALTER COLUMN token_enc SET NOT NULL`,
    `ALTER TABLE share_boards DROP COLUMN token`,
    `DROP INDEX IF EXISTS report_shares_token_hash_unique`,
    `CREATE UNIQUE INDEX report_shares_token_hash_unique ON report_shares (token_hash)`,
    `DROP INDEX IF EXISTS share_boards_token_hash_unique`,
    `CREATE UNIQUE INDEX share_boards_token_hash_unique ON share_boards (token_hash)`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_storage_size_positive`,
    `ALTER TABLE reports ADD CONSTRAINT reports_storage_size_positive
       CHECK (size_bytes >= 0 AND (storage_key IS NULL OR size_bytes > 0))`,
  ],
};
