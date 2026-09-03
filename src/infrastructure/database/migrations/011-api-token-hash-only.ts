import type { Migration } from "./index";


// ── v11：API 令牌恢复为只展示一次──
// token_lookup 本身是对 256-bit 随机令牌的 SHA-256 指纹，足以认证。
// 销毁可解密密文，避免数据库 + 应用密钥同时泄露时恢复所有 PAT。
export const API_TOKEN_HASH_ONLY: Migration = {
  version: 11,
  name: "api-token-hash-only",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_prefix TEXT NOT NULL DEFAULT 'sgk_'`,
    // 从 v6 直接跳到本版本的部署没有安全手段定位旧的加密令牌：
    // 在销毁密文前先撤销，而不是留下一条看似可用、实际已失效的活跃令牌。
    `UPDATE api_tokens SET revoked_at = NOW()
       WHERE revoked_at IS NULL AND token_lookup IS NULL`,
    `ALTER TABLE api_tokens DROP COLUMN IF EXISTS token_enc`,
  ],
};
