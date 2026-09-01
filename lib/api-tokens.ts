import { createHash, randomBytes } from "crypto";
import { db } from "./db";
import {
  clearSecurityFailures,
  isSecurityRateLimited,
  recordSecurityFailure,
} from "./db-rate-limit";
import { isGuestEmail } from "./guest-sandbox";
import { logger } from "./logger";
import { decryptApiToken, encryptApiToken } from "./api-token-store";

// ── 个人 API 访问令牌（PAT）──
// 用于程序化上传（/api/v1/*）：脚本/AI 无法走浏览器会话，
// 以 Bearer 令牌认证。每用户仅一个有效令牌，账户页可再次查看明文。
// 安全设计：
// - 明文 sgk_ + 43 位 base64url（32 字节 CSPRNG，≈256bit 熵），不可枚举
// - token_lookup 用 SHA-256 指纹完成索引认证，不需要解密全表
// - token_enc 用独立密钥 AES-256-GCM 加密，仅供令牌所有者回显
// - 更换（rotate）立即失效旧值；撤销即时生效；游客禁止使用

/** 令牌认证失败限速：同 IP 20 次 / 10 分钟 */
const AUTH_FAIL_LIMIT = 20;
const AUTH_FAIL_WINDOW_SEC = 10 * 60;

function tokenLookup(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): string {
  // base64url 无 padding：32 字节 → 43 字符
  return `sgk_${randomBytes(32).toString("base64url")}`;
}

export type ApiTokenInfo = {
  id: string;
  token: string | null;
};

export type ApiTokenErrorCode = "GUEST_UNSUPPORTED" | "TOKEN_ALREADY_EXISTS";
export type ApiTokenMutationResult =
  | { token: ApiTokenInfo }
  | { errorCode: ApiTokenErrorCode };

/**
 * 读取用户当前令牌并解密明文。
 */
export async function getApiToken(
  userId: string,
): Promise<ApiTokenInfo | null> {
  const { rows } = await db.query<{
    id: string;
    token_enc: string;
  }>(
    `SELECT id, token_enc
     FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  try {
    return {
      id: row.id,
      token: decryptApiToken(row.token_enc),
    };
  } catch (error) {
    logger.error("api-token", "failed to decrypt API token", error as Error, {
      userId,
      tokenId: row.id,
    });
    return { id: row.id, token: null };
  }
}

/**
 * 创建令牌（每用户仅一个）：返回含明文。
 * 游客拒绝；已有令牌拒绝（先撤销或用更换）。
 */
export async function createApiToken(
  userId: string,
  email: string,
): Promise<ApiTokenMutationResult> {
  if (isGuestEmail(email)) {
    return { errorCode: "GUEST_UNSUPPORTED" };
  }
  const token = generateApiToken();
  let ins: { id: string }[];
  try {
    ({ rows: ins } = await db.query<{ id: string }>(
      `INSERT INTO api_tokens
         (id, user_id, token_lookup, token_enc)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        randomBytes(16).toString("hex"),
        userId,
        tokenLookup(token),
        encryptApiToken(token),
      ],
    ));
  } catch (error) {
    // 部分唯一索引是并发安全的唯一事实源：
    // 两个同时到达的创建请求跨实例也不可能都成功。
    if ((error as { code?: string }).code === "23505") {
      return { errorCode: "TOKEN_ALREADY_EXISTS" };
    }
    throw error;
  }
  logger.info("api-token", "api token created", { userId });
  return {
    token: {
      id: ins[0].id,
      token,
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
): Promise<ApiTokenMutationResult> {
  if (isGuestEmail(email)) {
    return { errorCode: "GUEST_UNSUPPORTED" };
  }
  const token = generateApiToken();
  const { rows } = await db.query<{ id: string }>(
    `UPDATE api_tokens
     SET token_lookup = $1, token_enc = $2,
         created_at = NOW(), last_used_at = NULL
     WHERE user_id = $3 AND revoked_at IS NULL
     RETURNING id`,
    [tokenLookup(token), encryptApiToken(token), userId],
  );
  if (rows[0]) {
    logger.info("api-token", "api token rotated", { userId });
    return {
      token: {
        id: rows[0].id,
        token,
      },
    };
  }
  // 没有现有令牌 → 直接创建
  return createApiToken(userId, email);
}

/** 撤销令牌（校验属主） */
export async function revokeCurrentApiToken(userId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE api_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  if (rowCount) logger.info("api-token", "api token revoked", { userId });
  return rowCount === 1;
}

export type TokenAuthUser = { id: string; email: string };

/** 按 RFC 的大小写规则解析 Bearer scheme，同时严格限制本项目 PAT 格式。 */
export function parseApiBearerToken(authHeader: string | null): string | null {
  const match = authHeader?.match(/^\s*([A-Za-z]+)[\t ]+(\S+)\s*$/);
  if (!match || match[1].toLowerCase() !== "bearer") return null;
  return /^sgk_[A-Za-z0-9_-]{43}$/.test(match[2]) ? match[2] : null;
}

/**
 * 校验 Bearer 令牌 → 用户。失败返回 null。
 * 先做索引查找再查失败桶：有效令牌始终可用，共享 IP 下的
 * 攻击者不能通过制造失败把正常客户端锁死。
 */
export async function authenticateApiToken(
  authHeader: string | null,
  clientIp: string,
): Promise<TokenAuthUser | null> {
  const bearer = parseApiBearerToken(authHeader);
  if (!bearer) return null;
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    email: string;
  }>(
    `SELECT t.id, t.user_id, u.email
     FROM api_tokens t JOIN "user" u ON u.id = t.user_id
     WHERE t.revoked_at IS NULL AND t.token_lookup = $1
     LIMIT 1`,
    [tokenLookup(bearer)],
  );
  const row = rows[0];
  if (row && !isGuestEmail(row.email)) {
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
    logger.warn("api-token", "too many token auth failures; rate limited", { clientIp });
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
