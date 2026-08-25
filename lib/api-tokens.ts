import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db";
import { ensureOtpMigration } from "./schema";
import {
  clearSecurityFailures,
  isSecurityRateLimited,
  recordSecurityFailure,
} from "./db-rate-limit";
import { isGuestEmail } from "./guest-sandbox";
import { logger } from "./logger";

// ── 个人 API 访问令牌（PAT）──
// 用于程序化上传（/api/v1/*）：脚本/AI 无法走浏览器会话，
// 以 Bearer 令牌认证。密钥面板模式：每用户仅一个令牌，
// 明文可再次查看（AES-256-GCM 加密存储，密钥在环境变量）。
// 安全设计：
// - 明文 sgk_ + 43 位 base64url（32 字节 CSPRNG，≈256bit 熵），不可枚举
// - 库里存 AES-256-GCM 密文——数据库泄露没有 API_TOKEN_SECRET 也解不出
// - 认证用 timingSafeEqual 恒时比较；只有失败才按 IP 限速
// - 更换（rotate）立即失效旧值；撤销即时生效；访客禁止使用

/** 令牌认证失败限速：同 IP 20 次 / 10 分钟 */
const AUTH_FAIL_LIMIT = 20;
const AUTH_FAIL_WINDOW_SEC = 10 * 60;

// ── AES-256-GCM 加解密 ──
// 密钥解析：API_TOKEN_SECRET → SHARE_SECRET → DATABASE_URL（与分享密钥同回退链）
function encKey(): Buffer {
  const raw =
    process.env.API_TOKEN_SECRET ||
    process.env.SHARE_SECRET ||
    process.env.DATABASE_URL ||
    "";
  if (raw.length < 16) {
    throw new Error("缺少 API_TOKEN_SECRET（或 SHARE_SECRET / DATABASE_URL）");
  }
  // 任意长度的机密 → sha256 派生 32 字节密钥
  return createHash("sha256").update(raw).digest();
}

function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

function decryptToken(stored: string): string | null {
  const [ivS, tagS, encS] = stored.split(".");
  if (!ivS || !tagS || !encS) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivS, "base64url"));
    decipher.setAuthTag(Buffer.from(tagS, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encS, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null; // 密钥更换或密文损坏
  }
}

function tokenLookup(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): string {
  // base64url 无 padding：32 字节 → 43 字符
  return `sgk_${randomBytes(32).toString("base64url")}`;
}

export type ApiTokenInfo = {
  id: string;
  name: string;
  token: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/**
 * 读用户当前令牌（含解密明文）。
 * 无令牌返回 null；密文解不开返回 error（提示更换密钥配置）。
 */
export async function getApiToken(
  userId: string,
): Promise<ApiTokenInfo | { error: string } | null> {
  await ensureOtpMigration();
  const { rows } = await db.query<{
    id: string;
    name: string;
    token_enc: string;
    created_at: Date;
    last_used_at: Date | null;
  }>(
    `SELECT id, name, token_enc, created_at, last_used_at
     FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const token = decryptToken(row.token_enc);
  if (!token) {
    return { error: "令牌无法解密（服务器密钥可能已更换），请撤销后重新创建" };
  }
  return {
    id: row.id,
    name: row.name,
    token,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * 创建令牌（每用户仅一个）：返回含明文。
 * 访客拒绝；已有令牌拒绝（先撤销或用更换）。
 */
export async function createApiToken(
  userId: string,
  email: string,
  name = "",
): Promise<{ token: ApiTokenInfo } | { error: string }> {
  if (isGuestEmail(email)) {
    return { error: "访客模式不支持 API 令牌，注册正式账号后可用" };
  }
  await ensureOtpMigration();
  const token = generateApiToken();
  let ins: { id: string; created_at: Date }[];
  try {
    ({ rows: ins } = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO api_tokens (id, user_id, name, token_enc, token_lookup)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        randomBytes(16).toString("hex"),
        userId,
        name,
        encryptToken(token),
        tokenLookup(token),
      ],
    ));
  } catch (error) {
    // The partial unique index is the concurrency-safe source of truth. Two
    // simultaneous create requests cannot both pass across instances.
    if ((error as { code?: string }).code === "23505") {
      return { error: "已有令牌（每账号一个），可更换或撤销后重建" };
    }
    throw error;
  }
  logger.info("api-token", "创建 API 令牌", { userId });
  return {
    token: {
      id: ins[0].id,
      name,
      token,
      createdAt: ins[0].created_at,
      lastUsedAt: null,
    },
  };
}

/**
 * 更换令牌：旧值立即失效，返回新明文。
 * 无令牌时等价于创建。
 */
export async function rotateApiToken(
  userId: string,
  email: string,
): Promise<{ token: ApiTokenInfo } | { error: string }> {
  if (isGuestEmail(email)) {
    return { error: "访客模式不支持 API 令牌，注册正式账号后可用" };
  }
  await ensureOtpMigration();
  const token = generateApiToken();
  const { rows } = await db.query<{
    id: string;
    name: string;
    created_at: Date;
  }>(
    `UPDATE api_tokens
     SET token_enc = $1, token_lookup = $2, created_at = NOW(), last_used_at = NULL
     WHERE user_id = $3 AND revoked_at IS NULL
     RETURNING id, name, created_at`,
    [encryptToken(token), tokenLookup(token), userId],
  );
  if (rows[0]) {
    logger.info("api-token", "更换 API 令牌", { userId });
    return {
      token: {
        id: rows[0].id,
        name: rows[0].name,
        token,
        createdAt: rows[0].created_at,
        lastUsedAt: null,
      },
    };
  }
  // 没有现有令牌 → 直接创建
  return createApiToken(userId, email);
}

/** 撤销令牌（校验属主） */
export async function revokeApiToken(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE api_tokens SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  );
  if (rowCount) logger.info("api-token", "撤销 API 令牌", { userId, tokenId });
  return rowCount === 1;
}

/** 撤销用户全部有效令牌（注销账号时调用） */
export async function revokeAllApiTokens(userId: string): Promise<void> {
  await db.query(
    `UPDATE api_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

export type TokenAuthUser = { id: string; email: string };

/**
 * 校验 Bearer 令牌 → 用户。失败返回 null。
 * 先做索引查找再查失败桶：有效令牌始终可用，共享 IP 下的
 * 攻击者不能通过制造失败把正常客户端锁死。
 */
export async function authenticateApiToken(
  authHeader: string | null,
  clientIp: string,
): Promise<TokenAuthUser | null> {
  const bearer = authHeader?.match(/^Bearer\s+(sgk_\S+)$/i)?.[1];
  if (!bearer) return null;
  await ensureOtpMigration();
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    email: string;
    token_enc: string;
  }>(
    `SELECT t.id, t.user_id, u.email, t.token_enc
     FROM api_tokens t JOIN "user" u ON u.id = t.user_id
     WHERE t.revoked_at IS NULL AND t.token_lookup = $1
     LIMIT 1`,
    [tokenLookup(bearer)],
  );
  const row = rows[0];
  const plain = row ? decryptToken(row.token_enc) : null;
  if (
    row &&
    plain &&
    plain.length === bearer.length &&
    timingSafeEqual(Buffer.from(plain), Buffer.from(bearer)) &&
    !isGuestEmail(row.email)
  ) {
    await clearSecurityFailures("api-token-auth", clientIp);
    void db
      .query(`UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1`, [row.id])
      .catch(() => {});
    return { id: row.user_id, email: row.email };
  }
  const blocked = await isSecurityRateLimited(
    "api-token-auth",
    clientIp,
    AUTH_FAIL_LIMIT,
  );
  if (blocked.limited) {
    logger.warn("api-token", "认证失败次数过多，已限流", { clientIp });
    return null;
  }
  await recordSecurityFailure(
    "api-token-auth",
    clientIp,
    AUTH_FAIL_LIMIT,
    AUTH_FAIL_WINDOW_SEC,
  );
  return null;
}

/** Backfill lookup fingerprints for encrypted tokens created before migration v7. */
export async function backfillApiTokenLookups(): Promise<void> {
  const { rows } = await db.query<{ id: string; token_enc: string }>(
    `SELECT id, token_enc FROM api_tokens
     WHERE revoked_at IS NULL AND token_lookup IS NULL`,
  );
  for (const row of rows) {
    const plain = decryptToken(row.token_enc);
    if (!plain) {
      await db.query(`UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1`, [
        row.id,
      ]);
      logger.warn("api-token", "无法解密存量令牌，已安全撤销", { tokenId: row.id });
      continue;
    }
    await db.query(`UPDATE api_tokens SET token_lookup = $1 WHERE id = $2`, [
      tokenLookup(plain),
      row.id,
    ]);
  }
}
