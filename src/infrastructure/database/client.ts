import { Pool } from "pg";

const DB_QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS ?? 15_000);

// 业务数据访问用共享连接池（auth 也有自己的 Pool）
export const db = new Pool({
  connectionString: process.env.DATABASE_URL!,
  // 池参数显式化：默认 max=10 不变（可通过 DB_POOL_MAX 调整）；
  // 建连/空闲超时兜底，防止数据库或代理抖动时请求无限挂起
  max: Number(process.env.DB_POOL_MAX ?? 10),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  // 同时约束客户端等待与 PostgreSQL 执行：认证与写操作必须显式失败，
  // 而不是让 UI 永远挂起。
  query_timeout: DB_QUERY_TIMEOUT_MS,
  statement_timeout: DB_QUERY_TIMEOUT_MS,
  lock_timeout: Math.min(DB_QUERY_TIMEOUT_MS, 5_000),
});

/**
 * 串行化同时影响全站配额与单用户文件的操作。
 * 所有调用方都按「全局 → 用户」的顺序加锁，并用持锁连接执行数据库工作，
 * 因此 DB_POOL_MAX=1 也不会自死锁。
 */
export async function withStorageLocks<T>(
  userId: string,
  fn: (client: import("pg").PoolClient) => Promise<T>,
  options: { global?: boolean } = {},
): Promise<T> {
  const client = await db.connect();
  const globalKey = "storage-quota:global";
  const userKey = `storage-quota:${userId}`;
  const useGlobal = options.global !== false;
  try {
    if (useGlobal) {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        globalKey,
      ]);
    }
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      userKey,
    ]);
    return await fn(client);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [userKey])
      .catch(() => {});
    if (useGlobal) {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [globalKey])
        .catch(() => {});
    }
    client.release();
  }
}
