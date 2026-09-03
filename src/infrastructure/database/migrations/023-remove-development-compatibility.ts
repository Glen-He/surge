import type { Migration } from "./index";


// ── v23：移除开发期历史兼容并收紧当前数据模型──
// 旧软撤销记录和无法恢复提取码的 hash-only 分享直接删除；当前分享要求
// password_hash/password_enc 成对存在。标签色统一回填默认值后由数据库
// 强制限定为色板成员，运行时不再静默兜底损坏数据。
export const REMOVE_DEVELOPMENT_COMPATIBILITY: Migration = {
  version: 23,
  name: "remove-development-compatibility",
  statements: [
    `DELETE FROM report_shares
       WHERE revoked_at IS NOT NULL
          OR (password_hash IS NULL) <> (password_enc IS NULL)`,
    `DELETE FROM share_boards
       WHERE (password_hash IS NULL) <> (password_enc IS NULL)`,
    `ALTER TABLE report_shares DROP COLUMN revoked_at`,
    `ALTER TABLE report_shares
       ADD CONSTRAINT report_shares_password_pair
       CHECK ((password_hash IS NULL) = (password_enc IS NULL))`,
    `ALTER TABLE share_boards
       ADD CONSTRAINT share_boards_password_pair
       CHECK ((password_hash IS NULL) = (password_enc IS NULL))`,
    `UPDATE reports SET tag_color = '#FEE2E2'
       WHERE tag_color IS NULL
          OR tag_color NOT IN (
            '#FEE2E2', '#FFEDD5', '#FEF3C7', '#DCFCE7',
            '#DBEAFE', '#F3E8FF', '#F1F5F9'
          )`,
    `ALTER TABLE reports ALTER COLUMN tag_color SET DEFAULT '#FEE2E2'`,
    `ALTER TABLE reports ALTER COLUMN tag_color SET NOT NULL`,
    `ALTER TABLE reports
       ADD CONSTRAINT reports_tag_color_palette
       CHECK (tag_color IN (
         '#FEE2E2', '#FFEDD5', '#FEF3C7', '#DCFCE7',
         '#DBEAFE', '#F3E8FF', '#F1F5F9'
       ))`,
  ],
};
