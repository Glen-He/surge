import type { Migration } from "./migration";


// ── v25：运行时注册策略与一次性邀请码──
// 注册开关必须由管理员即时管理，不能依赖重启进程才能生效的环境变量。
// 邀请码用 HMAC lookup 校验，同时以独立派生密钥加密保存，供管理员再次
// 复制。数据库只读泄漏不会直接暴露可用邀请码。
export const REGISTRATION_ADMIN: Migration = {
  version: 25,
  name: "registration-admin",
  statements: [
    `CREATE TABLE registration_settings (
       id                   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
       registration_enabled BOOLEAN NOT NULL DEFAULT FALSE,
       invite_required      BOOLEAN NOT NULL DEFAULT FALSE,
       updated_by           TEXT REFERENCES "user"(id) ON DELETE SET NULL,
       updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT registration_settings_invite_requires_registration
         CHECK (registration_enabled OR NOT invite_required)
     )`,
    `INSERT INTO registration_settings
       (id, registration_enabled, invite_required)
     VALUES (TRUE, FALSE, FALSE)`,
    `CREATE TABLE registration_invites (
       id          TEXT PRIMARY KEY,
       code_lookup TEXT NOT NULL UNIQUE,
       code_enc    TEXT NOT NULL,
       label       TEXT CHECK (label IS NULL OR char_length(label) <= 60),
       max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
       use_count   INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
       expires_at  TIMESTAMPTZ,
       disabled_at TIMESTAMPTZ,
       created_by  TEXT REFERENCES "user"(id) ON DELETE SET NULL,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT registration_invites_expiry_after_creation
         CHECK (expires_at IS NULL OR expires_at > created_at)
     )`,
    `CREATE INDEX registration_invites_created_at
       ON registration_invites (created_at DESC)`,
    `CREATE INDEX registration_invites_active_expiry
       ON registration_invites (expires_at)
       WHERE disabled_at IS NULL`,
    `CREATE TABLE registration_invite_redemptions (
       id          TEXT PRIMARY KEY,
       invite_id   TEXT NOT NULL REFERENCES registration_invites(id) ON DELETE RESTRICT,
       user_id     TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
       redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX registration_invite_redemptions_invite
       ON registration_invite_redemptions (invite_id, redeemed_at DESC)`,
  ],
};
