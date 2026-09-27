import { Client } from "pg";
import { serverEnv } from "@/infrastructure/environment/server";

/** 串行化完整启动迁移，避免认证库内省与项目删列等 DDL 在不同实例间交错。 */
export async function withSchemaInitializationLock<T>(initialize: () => Promise<T>): Promise<T> {
  // 独立连接只持锁，不占用业务池；DB_POOL_MAX=1 时回调仍能取得业务连接。
  const client = new Client({
    connectionString: serverEnv.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    query_timeout: 65_000,
    statement_timeout: 60_000,
  });
  try {
    await client.connect();
    await client.query("SELECT pg_advisory_lock(hashtextextended('surge:schema-initialization', 0))");
    return await initialize();
  } finally {
    // 关闭专用会话自动释放锁，也覆盖回调失败与连接建立失败。
    await client.end();
  }
}
