import { createHash } from "crypto";
import { db } from "@/infrastructure/database/client";

function safeKey(namespace: string, subject: string): string {
  return `${namespace}:${createHash("sha256").update(subject).digest("hex")}`;
}

/** 在所有应用实例间原子消费一次 fixed-window 限流额度。 */
export async function consumeSharedRateLimit(
  namespace: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const { rows } = await db.query<{ attempts: number; reset_at: Date }>(
    `INSERT INTO security_rate_limits (key, attempts, reset_at)
     VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 second'))
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE
         WHEN security_rate_limits.reset_at <= NOW() THEN 1
         ELSE security_rate_limits.attempts + 1
       END,
       reset_at = CASE
         WHEN security_rate_limits.reset_at <= NOW()
           THEN NOW() + ($2 * INTERVAL '1 second')
         ELSE security_rate_limits.reset_at
       END,
       updated_at = NOW()
     RETURNING attempts, reset_at`,
    [safeKey(namespace, subject), windowSeconds],
  );
  const row = rows[0];
  return {
    allowed: row.attempts <= max,
    retryAfter: Math.max(
      1,
      Math.ceil((row.reset_at.getTime() - Date.now()) / 1000),
    ),
  };
}

export async function isSecurityRateLimited(
  namespace: string,
  subject: string,
  max: number,
): Promise<{ limited: boolean; retryAfter: number }> {
  const { rows } = await db.query<{ attempts: number; reset_at: Date }>(
    `SELECT attempts, reset_at FROM security_rate_limits
     WHERE key = $1 AND reset_at > NOW()`,
    [safeKey(namespace, subject)],
  );
  const row = rows[0];
  return {
    limited: !!row && row.attempts >= max,
    retryAfter: row
      ? Math.max(1, Math.ceil((row.reset_at.getTime() - Date.now()) / 1000))
      : 0,
  };
}

/** 在所有应用实例间原子记录一次失败尝试。 */
export async function recordSecurityFailure(
  namespace: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<{ limited: boolean; retryAfter: number }> {
  const { rows } = await db.query<{ attempts: number; reset_at: Date }>(
    `WITH expired AS (
       DELETE FROM security_rate_limits WHERE reset_at <= NOW() AND key <> $1
     )
     INSERT INTO security_rate_limits (key, attempts, reset_at)
     VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 second'))
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE
         WHEN security_rate_limits.reset_at <= NOW() THEN 1
         ELSE security_rate_limits.attempts + 1
       END,
       reset_at = CASE
         WHEN security_rate_limits.reset_at <= NOW()
           THEN NOW() + ($2 * INTERVAL '1 second')
         ELSE security_rate_limits.reset_at
       END,
       updated_at = NOW()
     RETURNING attempts, reset_at`,
    [safeKey(namespace, subject), windowSeconds],
  );
  const row = rows[0];
  return {
    // 第 max 次尝试仍放行；之后的尝试会被前置检查拦截
    // （并发下也可能由这里的 > max 结果拦截）。
    limited: row.attempts > max,
    retryAfter: Math.max(
      1,
      Math.ceil((row.reset_at.getTime() - Date.now()) / 1000),
    ),
  };
}

export async function clearSecurityFailures(
  namespace: string,
  subject: string,
): Promise<void> {
  await db.query(`DELETE FROM security_rate_limits WHERE key = $1`, [
    safeKey(namespace, subject),
  ]);
}

export async function purgeExpiredSecurityRateLimits(): Promise<void> {
  await db.query(`DELETE FROM security_rate_limits WHERE reset_at <= NOW()`);
}
