import { Pool } from "pg";

// 业务数据访问用共享连接池（auth 也有自己的 Pool）
export const db = new Pool({
  connectionString: process.env.DATABASE_URL!,
  // 池参数显式化：默认 max=10 不变（可通过 DB_POOL_MAX 调整）；
  // 建连/空闲超时兜底，防止数据库或代理抖动时请求无限挂起
  max: Number(process.env.DB_POOL_MAX ?? 10),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

/**
 * Serializes operations that affect the site-wide quota as well as one user's
 * files. Every caller acquires locks in the same global -> user order and uses
 * the lock-holding client for DB work, so DB_POOL_MAX=1 cannot self-deadlock.
 */
export async function withStorageLocks<T>(
  userId: string,
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  const globalKey = "storage-quota:global";
  const userKey = `storage-quota:${userId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      globalKey,
    ]);
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      userKey,
    ]);
    return await fn(client);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [userKey])
      .catch(() => {});
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [globalKey])
      .catch(() => {});
    client.release();
  }
}
