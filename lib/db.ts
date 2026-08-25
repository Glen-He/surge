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
 * 用户级存储配额锁：磁盘配额检查（目录统计）与写盘不是原子的，
 * 并行上传会各自读到旧存量而双双超额。用 PostgreSQL advisory lock
 * 串行化同一用户的「检查 + 写入」临界区（跨进程生效，重启不丢失）。
 * 锁在专用连接上持有，finally 中必然释放；连接异常断开时服务端
 * 会随连接自动回收锁。
 */
export async function withUserStorageLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  const key = `storage-quota:${userId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
    return await fn();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
    } catch {
      // 连接已断开时锁由服务端回收，忽略解锁错误
    }
    client.release();
  }
}
