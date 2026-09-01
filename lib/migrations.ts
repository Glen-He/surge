import { createHash } from "node:crypto";
import { db } from "./db";
import { logger } from "./logger";

// 版本化数据库迁移：
// - schema_migrations 表记录已应用版本；每个版本在事务内执行并登记，只跑一次
// - 版本 1 为基线（全部 IF NOT EXISTS 幂等语句）：存量库执行时无副作用、仅登记
//   版本；全新库则一次建齐。此后结构变更一律追加新版本，不再依赖幂等重放
// - pg_advisory_lock 防止多实例并发迁移（同库多进程同时启动的场景）
//
// 新增迁移示例：
//   MIGRATIONS.push({ version: 2, name: "add-xxx", statements: ["ALTER TABLE …"] });

type Migration = { version: number; name: string; statements: string[] };

const BASELINE: Migration = {
  version: 1,
  name: "baseline",
  statements: [
    // ── reports ──
    `CREATE TABLE IF NOT EXISTS reports (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      slug        TEXT NOT NULL,
      title       TEXT NOT NULL,
      date        TEXT NOT NULL,
      tag         TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      keywords    TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, slug)
    )`,
    // 卡片手动排序（拖拽调序）；旧数据按日期倒序回填
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS sort_order INTEGER`,
    // 标签颜色（7 色板之一，见 lib/tag-colors.ts；旧行为空时前端按标签哈希兜底）
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS tag_color TEXT`,
    `UPDATE reports SET sort_order = sub.rn
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id ORDER BY date DESC, created_at DESC
               ) AS rn
        FROM reports
        WHERE sort_order IS NULL
      ) sub
      WHERE reports.id = sub.id`,
    // ── security_logs（账户安全事件：变更凭证 / 审计 / OTP 频控）──
    `CREATE TABLE IF NOT EXISTS security_logs (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT REFERENCES "user"(id) ON DELETE SET NULL,
      action      TEXT NOT NULL,
      email       TEXT,
      ip          TEXT,
      user_agent  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // 给已存在的旧表补 email 列（CREATE TABLE IF NOT EXISTS 不会补列）
    `ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS email TEXT`,
    `CREATE INDEX IF NOT EXISTS security_logs_email_time
      ON security_logs (email, created_at)`,
    `CREATE INDEX IF NOT EXISTS security_logs_action_time
      ON security_logs (action, created_at)`,
    // ── account_changes（一次性安全 token：email_change / password_change / otp_verification）──
    `CREATE TABLE IF NOT EXISTS account_changes (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      type         TEXT NOT NULL,
      target       TEXT,
      payload      JSONB,
      expires_at   TIMESTAMPTZ NOT NULL,
      consumed     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS account_changes_user_type
      ON account_changes (user_id, type, expires_at)`,
    // ── otp_codes（自管 OTP：统一尝试次数 / 过期 / 一次性）──
    `CREATE TABLE IF NOT EXISTS otp_codes (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      purpose    TEXT NOT NULL,
      code       TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS otp_codes_email_purpose
      ON otp_codes (email, purpose)`,
    // ── user 表增量列 ──
    // 并发版本号（多设备修改邮箱安全）
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`,
    // 账号删除冷却期：非 NULL 表示已申请删除，+15 天到期后物理清除
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ`,
    // 邮箱唯一约束（better-auth 默认 email 唯一，这里显式保证）
    `CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique
      ON "user" (email)`,
    // ── guest_sessions（游客沙箱元信息：60 分钟过期、登出即销毁）──
    `CREATE TABLE IF NOT EXISTS guest_sessions (
      user_id     TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS guest_sessions_expires
      ON guest_sessions (expires_at)`,
    // ── report_shares（报告只读分享：token 高熵不可枚举，密码 scrypt，删除报告级联清理）──
    `CREATE TABLE IF NOT EXISTS report_shares (
      id            TEXT PRIMARY KEY,
      report_id     TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      token         TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      expires_at    TIMESTAMPTZ,
      revoked_at    TIMESTAMPTZ,
      view_count    BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS report_shares_report
      ON report_shares (report_id)`,
  ],
};

// ── v2：api_tokens（程序化上传 API 的个人访问令牌）──
// 令牌明文仅创建瞬间展示一次，库里只存 scrypt 哈希；
// 撤销用 revoked_at 软删除；last_used_at 供用户在设置页查看
const API_TOKENS: Migration = {
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

const MIGRATIONS: Migration[] = [BASELINE, API_TOKENS];

// ── v3：令牌改为可再次查看（AES-GCM 加密存储）──
// token_hash 是单向 scrypt，无法还原明文 → 加 token_enc 列存密文；
// 存量哈希令牌（本功能刚上线，仅测试数据）直接作废
const API_TOKEN_ENC: Migration = {
  version: 3,
  name: "api-token-enc",
  statements: [
    `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `UPDATE api_tokens SET token_enc = '', revoked_at = NOW()
      WHERE token_enc IS NULL`,
    `ALTER TABLE api_tokens ALTER COLUMN token_enc SET NOT NULL`,
  ],
};

MIGRATIONS.push(API_TOKEN_ENC);

// ── v4：删除废弃的 token_hash 列（v2 遗留，NOT NULL + UNIQUE，
// 与空串占位冲突且已无用途——令牌改存 token_enc）──
const API_TOKEN_DROP_HASH: Migration = {
  version: 4,
  name: "api-token-drop-hash",
  statements: [`ALTER TABLE api_tokens DROP COLUMN IF EXISTS token_hash`],
};

MIGRATIONS.push(API_TOKEN_DROP_HASH);

// ── v5：报告内容世代（report capability 架构）──
// 一个报告只保留一份当前文件目录；revision_id 是该内容世代的标识，
// 每次替换文件时轮换。capability（/r/<cap>/ 虚拟目录的访问凭证）绑定
// reportId + revisionId，报告更新后旧 capability 整体失效（404），
// 不保存任何历史版本。存量行回填随机值即可（旧 capability 不存在）。
const REPORT_REVISION: Migration = {
  version: 5,
  name: "report-revision",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS revision_id TEXT`,
    `UPDATE reports SET revision_id = md5(random()::text || id)
      WHERE revision_id IS NULL`,
    `ALTER TABLE reports ALTER COLUMN revision_id SET NOT NULL`,
  ],
};

MIGRATIONS.push(REPORT_REVISION);

// ── v6：报告 capability 纪元（撤销语义）──
// capability 只绑 reportId+revisionId 时，撤销分享后已签发的 capability
// 在 TTL 内仍有效（权限在父页签发时裁决，runtime 无法追溯）。epoch 是
// 报告级吊销开关：撤销分享等权限变化时 +1，runtime 要求 cap.epoch 与
// DB 当前值一致，旧 capability 立即整体失效（副作用：该报告所有 cap
// 失效，刷新父页即重新签发，属可接受的简单化）。
const REPORT_CAP_EPOCH: Migration = {
  version: 6,
  name: "report-capability-epoch",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS capability_epoch
       INTEGER NOT NULL DEFAULT 0`,
  ],
};

MIGRATIONS.push(REPORT_CAP_EPOCH);

// ── v7：API 令牌可索引指纹 ──
// 认证不再加载并解密全部令牌；token_lookup 是高熵令牌的
// SHA-256 指纹，只用于等值定位。旧版本会在销毁密文前完成回填。
const API_TOKEN_LOOKUP: Migration = {
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

MIGRATIONS.push(API_TOKEN_LOOKUP);

// ── v8：OTP 脱敏存储 ──
// 6 位码不得明文落库。存量 OTP 最长仅 5 分钟，部署时直接作废，
// 避免在迁移中需要短暂接触明文或依赖应用密钥。
const OTP_HASH: Migration = {
  version: 8,
  name: "otp-hash",
  statements: [
    `ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_hash TEXT`,
    `DELETE FROM otp_codes`,
    `ALTER TABLE otp_codes ALTER COLUMN code_hash SET NOT NULL`,
    `ALTER TABLE otp_codes DROP COLUMN IF EXISTS code`,
  ],
};

MIGRATIONS.push(OTP_HASH);

// ── v9：多实例共享的安全失败限流 ──
const SECURITY_RATE_LIMITS: Migration = {
  version: 9,
  name: "security-rate-limits",
  statements: [
    `CREATE TABLE IF NOT EXISTS security_rate_limits (
       key        TEXT PRIMARY KEY,
       attempts   INTEGER NOT NULL,
       reset_at   TIMESTAMPTZ NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS security_rate_limits_reset
       ON security_rate_limits (reset_at)`,
  ],
};

MIGRATIONS.push(SECURITY_RATE_LIMITS);

// ── v10：报告存储字节记账 + 日期数据库约束 ──
// size_bytes 让每次上传无需递归扫描整个持久卷。v10 为既有行暂设 0，
// v22 在数据转正后要求私有 artifact 的记账必须为正数。日期约束
// NOT VALID 避免当时的数据阻塞发布，但会立即拒绝之后的非法写入。
const REPORT_STORAGE_ACCOUNTING: Migration = {
  version: 10,
  name: "report-storage-accounting",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_date_iso`,
    `ALTER TABLE reports ADD CONSTRAINT reports_date_iso
       CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND date::date IS NOT NULL) NOT VALID`,
    `CREATE INDEX IF NOT EXISTS reports_user_size ON reports (user_id) INCLUDE (size_bytes)`,
  ],
};

MIGRATIONS.push(REPORT_STORAGE_ACCOUNTING);

// ── v11：API 令牌恢复为只展示一次──
// token_lookup 本身是对 256-bit 随机令牌的 SHA-256 指纹，足以认证。
// 销毁可解密密文，避免数据库 + 应用密钥同时泄露时恢复所有 PAT。
const API_TOKEN_HASH_ONLY: Migration = {
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

MIGRATIONS.push(API_TOKEN_HASH_ONLY);

// ── v12：多分享面板──
// 一个用户可针对不同查看对象创建多个面板；同一报告可加入多个面板。
// 面板 token 是公开入口，item id 是面板内报告的非业务标识，避免暴露报告 slug。
const SHARE_BOARDS: Migration = {
  version: 12,
  name: "share-boards",
  statements: [
    `CREATE TABLE IF NOT EXISTS share_boards (
       id            TEXT PRIMARY KEY,
       user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
       token         TEXT NOT NULL UNIQUE,
       title         TEXT NOT NULL,
       password_hash TEXT,
       disabled_at   TIMESTAMPTZ,
       view_count    BIGINT NOT NULL DEFAULT 0,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS share_boards_user
       ON share_boards (user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS share_board_items (
       id         TEXT PRIMARY KEY,
       board_id   TEXT NOT NULL REFERENCES share_boards(id) ON DELETE CASCADE,
       report_id  TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (board_id, report_id)
     )`,
    `CREATE INDEX IF NOT EXISTS share_board_items_board
       ON share_board_items (board_id)`,
    `CREATE INDEX IF NOT EXISTS share_board_items_report
       ON share_board_items (report_id)`,
  ],
};

MIGRATIONS.push(SHARE_BOARDS);

// ── v13：游客示例改为共享只读模板引用 ──
// template_key 为 NULL 时，报告内容位于用户独立目录；非 NULL 时，
// 只能由服务端映射到代码库内的允许列表模板。模板字节只存一份，
// 游客的标题、排序、revision 等仍是独立数据库记录。替换文件时
// 应用将 template_key 清空，自动转为用户私有副本（copy-on-write）。
const REPORT_TEMPLATE_REFERENCE: Migration = {
  version: 13,
  name: "report-template-reference",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS template_key TEXT`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_template_key_safe`,
    `ALTER TABLE reports ADD CONSTRAINT reports_template_key_safe
       CHECK (template_key IS NULL OR template_key ~ '^tpl-[0-9]{2}$')`,
    `CREATE INDEX IF NOT EXISTS reports_template_key
       ON reports (template_key) WHERE template_key IS NOT NULL`,
  ],
};

MIGRATIONS.push(REPORT_TEMPLATE_REFERENCE);

// ── v14：不可变报告版本 + 跨实例上传租约──
// storage_key 指向用户目录下不可变的 artifacts/<key>。替换文件时先发布
// 新目录，再用一次 UPDATE 切换数据库指针；无论进程在哪一步崩溃，旧
// capability 都不会读取到新字节。v14 曾为数据转正暂时允许 NULL，
// v21/v22 已将内容来源收紧为严格二选一。
const IMMUTABLE_REPORT_STORAGE: Migration = {
  version: 14,
  name: "immutable-report-storage",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS storage_key TEXT`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_storage_key_safe`,
    `ALTER TABLE reports ADD CONSTRAINT reports_storage_key_safe
       CHECK (storage_key IS NULL OR storage_key ~ '^a_[0-9a-f]{32}$')`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reports_storage_key_unique
       ON reports (user_id, storage_key) WHERE storage_key IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS upload_leases (
       slot_id    INTEGER PRIMARY KEY,
       holder     TEXT NOT NULL UNIQUE,
       expires_at TIMESTAMPTZ NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS upload_leases_expiry
       ON upload_leases (expires_at)`,
  ],
};

MIGRATIONS.push(IMMUTABLE_REPORT_STORAGE);

// ── v15：生命周期清理索引──
// 后台按过期时间小批量删除，索引避免数据增长后维护任务扫描整表。
const RETENTION_CLEANUP_INDEXES: Migration = {
  version: 15,
  name: "retention-cleanup-indexes",
  statements: [
    `CREATE INDEX IF NOT EXISTS security_logs_created_at
       ON security_logs (created_at)`,
    `CREATE INDEX IF NOT EXISTS otp_codes_expires_at
       ON otp_codes (expires_at)`,
    `CREATE INDEX IF NOT EXISTS account_changes_expires_at
       ON account_changes (expires_at)`,
    `CREATE INDEX IF NOT EXISTS verification_expires_at
       ON verification ("expiresAt")`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_one_content_source`,
    `ALTER TABLE reports ADD CONSTRAINT reports_one_content_source
       CHECK (template_key IS NULL OR storage_key IS NULL)`,
  ],
};

MIGRATIONS.push(RETENTION_CLEANUP_INDEXES);

const SHARE_CREDENTIAL_HARDENING: Migration = {
  version: 16,
  name: "share-credential-hardening",
  statements: [
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS token_hash TEXT`,
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `ALTER TABLE report_shares ALTER COLUMN token DROP NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS report_shares_token_hash_unique
       ON report_shares (token_hash) WHERE token_hash IS NOT NULL`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS token_hash TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS token_enc TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS access_epoch INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE share_boards ALTER COLUMN token DROP NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS share_boards_token_hash_unique
       ON share_boards (token_hash) WHERE token_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS share_boards_expires_at
       ON share_boards (expires_at) WHERE expires_at IS NOT NULL`,
  ],
};

MIGRATIONS.push(SHARE_CREDENTIAL_HARDENING);

const MAINTENANCE_STATE: Migration = {
  version: 17,
  name: "maintenance-state",
  statements: [
    `CREATE TABLE IF NOT EXISTS maintenance_state (
       name TEXT PRIMARY KEY,
       last_started_at TIMESTAMPTZ,
       last_succeeded_at TIMESTAMPTZ,
       last_error TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ],
};

MIGRATIONS.push(MAINTENANCE_STATE);

// ── v20：可再次复制的 4 位分享提取码──
// 验证仍使用 scrypt 哈希；密文只供属主重新复制“链接 + 提取码”，
// 且与分享 token 使用不同的派生密钥。v23 会清理无法恢复的 hash-only 记录。
const SHARE_PASSCODE_RECOVERY: Migration = {
  version: 20,
  name: "share-passcode-recovery",
  statements: [
    `ALTER TABLE report_shares ADD COLUMN IF NOT EXISTS password_enc TEXT`,
    `ALTER TABLE share_boards ADD COLUMN IF NOT EXISTS password_enc TEXT`,
  ],
};

MIGRATIONS.push(SHARE_PASSCODE_RECOVERY);

// ── v21：每条报告必须且只能有一种内容来源──
// 发布迁移期间以 NOT VALID 先约束新写入，v22 在数据转正后完成验证。
const REPORT_CONTENT_SOURCE_REQUIRED: Migration = {
  version: 21,
  name: "report-content-source-required",
  statements: [
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_one_content_source`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_exactly_one_content_source`,
    `ALTER TABLE reports ADD CONSTRAINT reports_exactly_one_content_source
       CHECK (num_nonnulls(template_key, storage_key) = 1) NOT VALID`,
  ],
};

MIGRATIONS.push(REPORT_CONTENT_SOURCE_REQUIRED);

// ── v22：收紧最终运行时不变量──
// 生产数据完成转正后，不再保留明文 token 列、请求期加固任务或零字节
// 报告回填。迁移先验证数据完整性，异常时整体回滚并拒绝实例启动。
const FINAL_RUNTIME_INVARIANTS: Migration = {
  version: 22,
  name: "final-runtime-invariants",
  statements: [
    `ALTER TABLE reports VALIDATE CONSTRAINT reports_exactly_one_content_source`,
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM report_shares
         WHERE token IS NOT NULL OR token_hash IS NULL OR token_enc IS NULL
       ) THEN
         RAISE EXCEPTION 'report share token migration is incomplete';
       END IF;
       IF EXISTS (
         SELECT 1 FROM share_boards
         WHERE token IS NOT NULL OR token_hash IS NULL OR token_enc IS NULL
       ) THEN
         RAISE EXCEPTION 'share board token migration is incomplete';
       END IF;
     END $$`,
    `ALTER TABLE report_shares ALTER COLUMN token_hash SET NOT NULL`,
    `ALTER TABLE report_shares ALTER COLUMN token_enc SET NOT NULL`,
    `ALTER TABLE report_shares DROP COLUMN token`,
    `ALTER TABLE share_boards ALTER COLUMN token_hash SET NOT NULL`,
    `ALTER TABLE share_boards ALTER COLUMN token_enc SET NOT NULL`,
    `ALTER TABLE share_boards DROP COLUMN token`,
    `DROP INDEX IF EXISTS report_shares_token_hash_unique`,
    `CREATE UNIQUE INDEX report_shares_token_hash_unique ON report_shares (token_hash)`,
    `DROP INDEX IF EXISTS share_boards_token_hash_unique`,
    `CREATE UNIQUE INDEX share_boards_token_hash_unique ON share_boards (token_hash)`,
    `ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_storage_size_positive`,
    `ALTER TABLE reports ADD CONSTRAINT reports_storage_size_positive
       CHECK (size_bytes >= 0 AND (storage_key IS NULL OR size_bytes > 0))`,
  ],
};

MIGRATIONS.push(FINAL_RUNTIME_INVARIANTS);

// ── v23：移除开发期历史兼容并收紧当前数据模型──
// 旧软撤销记录和无法恢复提取码的 hash-only 分享直接删除；当前分享要求
// password_hash/password_enc 成对存在。标签色统一回填默认值后由数据库
// 强制限定为色板成员，运行时不再静默兜底损坏数据。
const REMOVE_DEVELOPMENT_COMPATIBILITY: Migration = {
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

MIGRATIONS.push(REMOVE_DEVELOPMENT_COMPATIBILITY);

// ── v24：删除报告外部网络能力──
// 汇报只允许加载当前 capability 目录内的资源；普通用户触发的新标签页
// 外链由 sandbox 独立放行，不依赖数据库开关。
const REMOVE_REPORT_EXTERNAL_NETWORK: Migration = {
  version: 24,
  name: "remove-report-external-network",
  statements: [
    `ALTER TABLE reports DROP COLUMN IF EXISTS external_network_enabled`,
  ],
};

MIGRATIONS.push(REMOVE_REPORT_EXTERNAL_NETWORK);

// ── v25：运行时注册策略与一次性邀请码──
// 注册开关必须由管理员即时管理，不能依赖重启进程才能生效的环境变量。
// 邀请码用 HMAC lookup 校验，同时以独立派生密钥加密保存，供管理员再次
// 复制。数据库只读泄漏不会直接暴露可用邀请码。
const REGISTRATION_ADMIN: Migration = {
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

MIGRATIONS.push(REGISTRATION_ADMIN);

// ── v26：用户级单邀请码与可回显 API 令牌──
// 每个正式用户只保留一条邀请码记录；更换时更新原记录，撤销后仍保留
// use_count 供以后奖励归因。API 令牌继续用 lookup 完成认证，同时恢复
// 独立 AES-GCM 密文供所有者随时查看；无法恢复的旧令牌在迁移时安全撤销。
const SINGLE_INVITE_AND_VISIBLE_API_TOKEN: Migration = {
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

MIGRATIONS.push(SINGLE_INVITE_AND_VISIBLE_API_TOKEN);

// 专用 advisory lock key（0x53555247 = "SURG"），避免与其他应用碰撞
const ADVISORY_LOCK_KEY = 0x53555247;

let ran: Promise<void> | null = null;

async function run(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const { rows } = await client.query<{ version: number; name: string; checksum: string | null }>(
      "SELECT version, name, checksum FROM schema_migrations",
    );
    const done = new Map(rows.map((r) => [r.version, r]));

    for (const m of MIGRATIONS) {
      const checksum = createHash("sha256")
        .update(m.name)
        .update("\0")
        .update(m.statements.join("\0"))
        .digest("hex");
      const existing = done.get(m.version);
      if (existing) {
        if (existing.name !== m.name) {
          throw new Error(`migration v${m.version} name changed`);
        }
        if (existing.checksum && existing.checksum !== checksum) {
          throw new Error(
            `migration v${m.version} content changed; applied migrations must stay immutable`,
          );
        }
        if (!existing.checksum) {
          await client.query(
            "UPDATE schema_migrations SET checksum = $2 WHERE version = $1 AND checksum IS NULL",
            [m.version, checksum],
          );
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        for (const sql of m.statements) await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [m.version, m.name, checksum],
        );
        await client.query("COMMIT");
        logger.info("migrations", "migration applied", {
          version: m.version,
          name: m.name,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
}

/** 确保迁移已全部应用（进程内单次；失败可重试）。 */
export function ensureSchemaVersioned(): Promise<void> {
  if (!ran) {
    ran = run().catch((err) => {
      ran = null; // 失败不缓存，下次调用重试
      throw err;
    });
  }
  return ran;
}
