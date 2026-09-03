import type { Migration } from "./migration";


// ── v5：报告内容世代（report capability 架构）──
// 一个报告只保留一份当前文件目录；revision_id 是该内容世代的标识，
// 每次替换文件时轮换。capability（/r/<cap>/ 虚拟目录的访问凭证）绑定
// reportId + revisionId，报告更新后旧 capability 整体失效（404），
// 不保存任何历史版本。存量行回填随机值即可（旧 capability 不存在）。
export const REPORT_REVISION: Migration = {
  version: 5,
  name: "report-revision",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS revision_id TEXT`,
    `UPDATE reports SET revision_id = md5(random()::text || id)
      WHERE revision_id IS NULL`,
    `ALTER TABLE reports ALTER COLUMN revision_id SET NOT NULL`,
  ],
};
