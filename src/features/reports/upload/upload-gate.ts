import { randomUUID } from "node:crypto";
import { db } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/logging/logger";

const LEASE_SECONDS = 10 * 60;
const RENEW_MS = 2 * 60 * 1000;

const UPLOAD_MAX_CONCURRENCY = Number(
  process.env.UPLOAD_MAX_CONCURRENCY ?? 2,
);

export function validateUploadGateSettings(): void {
  if (
    !Number.isSafeInteger(UPLOAD_MAX_CONCURRENCY) ||
    UPLOAD_MAX_CONCURRENCY < 1 ||
    UPLOAD_MAX_CONCURRENCY > 32
  ) {
    throw new Error("UPLOAD_MAX_CONCURRENCY must be an integer between 1 and 32");
  }
}

export type UploadLease = { release: () => Promise<void> };

/**
 * 获取一个数据库背书的上传并发名额，且不全程占用连接池连接。
 * 租约带过期时间，进程崩溃后可自动恢复。
 */
export async function tryAcquireUploadLease(): Promise<UploadLease | null> {
  const holder = randomUUID();
  const client = await db.connect();
  let slot: number | null = null;
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["upload-leases:global"],
    );
    await client.query("DELETE FROM upload_leases WHERE expires_at <= NOW()");
    const { rows } = await client.query<{ slot_id: number }>(
      `SELECT candidate AS slot_id
       FROM generate_series(1, $1::integer) AS candidate
       WHERE NOT EXISTS (
         SELECT 1 FROM upload_leases WHERE slot_id = candidate
       )
       ORDER BY candidate
       LIMIT 1`,
      [UPLOAD_MAX_CONCURRENCY],
    );
    slot = rows[0]?.slot_id ?? null;
    if (slot !== null) {
      await client.query(
        `INSERT INTO upload_leases (slot_id, holder, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))`,
        [slot, holder, LEASE_SECONDS],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (slot === null) return null;

  let released = false;
  const timer = setInterval(() => {
    void db
      .query(
        `UPDATE upload_leases
         SET expires_at = NOW() + ($1 * INTERVAL '1 second')
         WHERE holder = $2`,
        [LEASE_SECONDS, holder],
      )
      .catch((error) => {
        logger.warn("upload-gate", "failed to renew upload slot lease", error as Error);
      });
  }, RENEW_MS);
  timer.unref();

  return {
    async release() {
      if (released) return;
      released = true;
      clearInterval(timer);
      await db
        .query("DELETE FROM upload_leases WHERE holder = $1", [holder])
        .catch((error) => {
          logger.warn(
            "upload-gate",
            "failed to release upload slot lease; waiting for expiry",
            error as Error,
          );
        });
    },
  };
}
