import type { Migration } from "./migration";


// ── v2：api_tokens（程序化上传 API 的个人访问令牌）──
// 令牌明文仅创建瞬间展示一次，库里只存 scrypt 哈希；
// 撤销用 revoked_at 软删除；last_used_at 供用户在设置页查看
export const API_TOKENS: Migration = {
  version: 2,
  name: "api-tokens",
  statements: [
    `CREATE TABLE IF NOT EXISTS api_tokens (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      name         TEXT NOT NULL DEFAULT '',
      token_hash   TEXT NOT NULL UNIQUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at   TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS api_tokens_user
      ON api_tokens (user_id) WHERE revoked_at IS NULL`,
  ],
};
