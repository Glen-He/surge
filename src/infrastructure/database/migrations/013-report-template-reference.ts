import type { Migration } from "./index";


// ── v13：游客示例改为共享只读模板引用 ──
// template_key 为 NULL 时，报告内容位于用户独立目录；非 NULL 时，
// 只能由服务端映射到代码库内的允许列表模板。模板字节只存一份，
// 游客的标题、排序、revision 等仍是独立数据库记录。替换文件时
// 应用将 template_key 清空，自动转为用户私有副本（copy-on-write）。
export const REPORT_TEMPLATE_REFERENCE: Migration = {
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
