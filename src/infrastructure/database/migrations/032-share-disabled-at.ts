import type { Migration } from "./migration";

/**
 * 分享链接的「暂停分享」：属主可在设置里暂时停用一条链接，而不必撤销（物理删除）。
 * 公开读取路径（findValidShare / capability 资源路由）都会按该列 fail closed。
 */
export const SHARE_DISABLED_AT: Migration = {
  version: 32,
  name: "share-disabled-at",
  statements: [`ALTER TABLE report_shares ADD COLUMN disabled_at TIMESTAMPTZ`],
};
