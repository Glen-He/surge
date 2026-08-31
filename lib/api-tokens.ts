import { createHash, randomBytes } from "crypto";
import { db } from "./db";
import {
  clearSecurityFailures,
  isSecurityRateLimited,
  recordSecurityFailure,
} from "./db-rate-limit";
import { isGuestEmail } from "./guest-sandbox";
import { logger } from "./logger";

// ── 个人 API 访问令牌（PAT）──
// 用于程序化上传（/api/v1/*）：脚本/AI 无法走浏览器会话，
// 以 Bearer 令牌认证。每用户仅一个令牌，明文只在创建/更换响应中展示一次。
// 安全设计：
// - 明文 sgk_ + 43 位 base64url（32 字节 CSPRNG，≈256bit 熵），不可枚举
// - 库里只存 SHA-256 指纹，无法恢复明文
// - 令牌具有 256-bit 随机性，指纹等值定位不受低熵密码猜解威胁
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
  name: string;
  prefix: string;
  token?: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/**
 * 读用户当前令牌的非敏感元数据。明文不可恢复。
 */
export async function getApiToken(
  userId: string,
): Promise<ApiTokenInfo | null> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    token_prefix: string;
    created_at: Date;
    last_used_at: Date | null;
  }>(
    `SELECT id, name, token_prefix, created_at, last_used_at
     FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * 创建令牌（每用户仅一个）：返回含明文。
 * 游客拒绝；已有令牌拒绝（先撤销或用更换）。
 */
export async function createApiToken(
  userId: string,
  email: string,
  name = "",
): Promise<{ token: ApiTokenInfo } | { error: string }> {
  if (isGuestEmail(email)) {
    return { error: "游客模式不支持 API 令牌，注册正式账号后可用" };
  }
  const token = generateApiToken();
  let ins: { id: string; created_at: Date }[];
  try {
    ({ rows: ins } = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO api_tokens (id, user_id, name, token_lookup, token_prefix)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        randomBytes(16).toString("hex"),
        userId,
        name,
        tokenLookup(token),
        token.slice(0, 11),
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
      prefix: token.slice(0, 11),
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
    return { error: "游客模式不支持 API 令牌，注册正式账号后可用" };
  }
  const token = generateApiToken();
  const { rows } = await db.query<{
    id: string;
    name: string;
    created_at: Date;
  }>(
    `UPDATE api_tokens
     SET token_lookup = $1, token_prefix = $2, created_at = NOW(), last_used_at = NULL
     WHERE user_id = $3 AND revoked_at IS NULL
     RETURNING id, name, created_at`,
    [tokenLookup(token), token.slice(0, 11), userId],
  );
  if (rows[0]) {
    logger.info("api-token", "更换 API 令牌", { userId });
    return {
      token: {
        id: rows[0].id,
        name: rows[0].name,
        token,
        prefix: token.slice(0, 11),
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
