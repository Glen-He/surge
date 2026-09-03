import type { Migration } from "./migration";


// ── v21：每条报告必须且只能有一种内容来源──
// 发布迁移期间以 NOT VALID 先约束新写入，v22 在数据转正后完成验证。
export const REPORT_CONTENT_SOURCE_REQUIRED: Migration = {
  version: 21,
  name: "report-content-source-required",
  statements: [
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_one_content_source`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_exactly_one_content_source`,
    `ALTER TABLE reports ADD CONSTRAINT reports_exactly_one_content_source
       CHECK (num_nonnulls(template_key, storage_key) = 1) NOT VALID`,
  ],
};
