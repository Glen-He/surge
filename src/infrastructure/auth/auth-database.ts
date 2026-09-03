import { Pool } from "pg";
import { serverEnv } from "@/infrastructure/environment/server";

/** 创建 Better Auth 专用连接池，避免认证流量占满业务连接池。 */
export function createAuthDatabasePool(): Pool {
  const queryTimeout = serverEnv.AUTH_DB_QUERY_TIMEOUT_MS;
  return new Pool({
    connectionString: serverEnv.DATABASE_URL,
    max: serverEnv.DB_POOL_MAX,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    query_timeout: queryTimeout,
    statement_timeout: queryTimeout,
    lock_timeout: Math.min(queryTimeout, 5_000),
  });
}
