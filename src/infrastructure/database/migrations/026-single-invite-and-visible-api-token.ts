import type { Migration } from "./migration";


// ── v26：用户级单邀请码与可回显 API 令牌──
// 每个正式用户只保留一条邀请码记录；更换时更新原记录，撤销后仍保留
// use_count 供以后奖励归因。API 令牌继续用 lookup 完成认证，同时恢复
// 独立 AES-GCM 密文供所有者随时查看；无法恢复的旧令牌在迁移时安全撤销。
export const SINGLE_INVITE_AND_VISIBLE_API_TOKEN: Migration = {
  version: 26,
  name: "single-invite-and-visible-api-token",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `UPDATE api_tokens
       SET revoked_at = NOW()
       WHERE revoked_at IS NULL
         AND (token_enc IS NULL OR token_enc = '')`,
    `UPDATE api_tokens SET token_enc = '' WHERE token_enc IS NULL`,
    `ALTER TABLE api_tokens ALTER COLUMN token_enc SET NOT NULL`,
    `ALTER TABLE api_tokens
       DROP COLUMN IF EXISTS token_prefix,
       DROP COLUMN IF EXISTS name`,
    `WITH ranked AS (
       SELECT id,
              FIRST_VALUE(id) OVER (
                PARTITION BY created_by
                ORDER BY (disabled_at IS NULL) DESC, created_at DESC, id DESC
              ) AS keeper_id,
              ROW_NUMBER() OVER (
                PARTITION BY created_by
                ORDER BY (disabled_at IS NULL) DESC, created_at DESC, id DESC
              ) AS rn
       FROM registration_invites
       WHERE created_by IS NOT NULL
     )
     UPDATE registration_invite_redemptions r
        SET invite_id = ranked.keeper_id
       FROM ranked
      WHERE ranked.rn > 1 AND r.invite_id = ranked.id`,
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY created_by
                ORDER BY (disabled_at IS NULL) DESC, created_at DESC, id DESC
              ) AS rn
       FROM registration_invites
       WHERE created_by IS NOT NULL
     )
     DELETE FROM registration_invites i
      USING ranked
      WHERE ranked.rn > 1 AND i.id = ranked.id`,
    `ALTER TABLE registration_invites
       DROP CONSTRAINT IF EXISTS registration_invites_max_uses_check`,
    `ALTER TABLE registration_invites
       DROP CONSTRAINT IF EXISTS registration_invites_use_count_check`,
    `ALTER TABLE registration_invites
       DROP CONSTRAINT IF EXISTS registration_invites_expiry_after_creation`,
    `UPDATE registration_invites i
        SET use_count = (
          SELECT COUNT(*)::integer
          FROM registration_invite_redemptions r
          WHERE r.invite_id = i.id
        )`,
    `DROP INDEX IF EXISTS registration_invites_active_expiry`,
    `ALTER TABLE registration_invites
       DROP COLUMN IF EXISTS label,
       DROP COLUMN IF EXISTS max_uses,
       DROP COLUMN IF EXISTS expires_at`,
    `ALTER TABLE registration_invites
       ADD CONSTRAINT registration_invites_use_count_nonnegative
       CHECK (use_count >= 0)`,
    `CREATE UNIQUE INDEX registration_invites_one_per_creator
       ON registration_invites (created_by)
       WHERE created_by IS NOT NULL`,
  ],
};
