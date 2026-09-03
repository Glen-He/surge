import type { Migration } from "./migration";


// ── v3：令牌改为可再次查看（AES-GCM 加密存储）──
// token_hash 是单向 scrypt，无法还原明文 → 加 token_enc 列存密文；
// 存量哈希令牌（本功能刚上线，仅测试数据）直接作废
export const API_TOKEN_ENC: Migration = {
  version: 3,
  name: "api-token-enc",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `UPDATE api_tokens SET token_enc = '', revoked_at = NOW()
      WHERE token_enc IS NULL`,
    `ALTER TABLE api_tokens ALTER COLUMN token_enc SET NOT NULL`,
  ],
};
