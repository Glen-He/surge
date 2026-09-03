import type { Migration } from "./index";


// ── v4：删除废弃的 token_hash 列（v2 遗留，NOT NULL + UNIQUE，
// 与空串占位冲突且已无用途——令牌改存 token_enc）──
export const API_TOKEN_DROP_HASH: Migration = {
  version: 4,
  name: "api-token-drop-hash",
  statements: [`ALTER TABLE api_tokens DROP COLUMN IF EXISTS token_hash`],
};
