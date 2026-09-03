import type { Migration } from "./migration";


// ── v20：可再次复制的 4 位分享提取码──
// 验证仍使用 scrypt 哈希；密文只供属主重新复制“链接 + 提取码”，
// 且与分享 token 使用不同的派生密钥。v23 会清理无法恢复的 hash-only 记录。
export const SHARE_PASSCODE_RECOVERY: Migration = {
  version: 20,
  name: "share-passcode-recovery",
  statements: [
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS password_enc TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS password_enc TEXT`,
  ],
};
