import type { Migration } from "./index";


// ── v7：API 令牌可索引指纹 ──
// 认证不再加载并解密全部令牌；token_lookup 是高熵令牌的
// SHA-256 指纹，只用于等值定位。旧版本会在销毁密文前完成回填。
export const API_TOKEN_LOOKUP: Migration = {
  version: 7,
  name: "api-token-lookup",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_lookup TEXT`,
    // 旧版本本意是单活跃令牌，却用「先计数后插入」实现。
    // 在加数据库不变量之前，先修复竞态产生的重复行。
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY user_id ORDER BY created_at DESC, id DESC
              ) AS rn
       FROM api_tokens
       WHERE revoked_at IS NULL
     )
     UPDATE api_tokens t SET revoked_at = NOW()
     FROM ranked r WHERE t.id = r.id AND r.rn > 1`,
    `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_lookup_active
       ON api_tokens (token_lookup) WHERE revoked_at IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_one_active_per_user
       ON api_tokens (user_id) WHERE revoked_at IS NULL`,
  ],
};
