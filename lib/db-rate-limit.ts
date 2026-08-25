import { createHash } from "crypto";
import { db } from "./db";

function safeKey(namespace: string, subject: string): string {
  return `${namespace}:${createHash("sha256").update(subject).digest("hex")}`;
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

/** Atomically records one failed attempt across all application instances. */
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
    // The max-th attempt is allowed; subsequent attempts are blocked by the
    // pre-check (or by this > max result under concurrency).
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
