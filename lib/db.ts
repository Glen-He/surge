import { Pool } from "pg";

// 业务数据访问用共享连接池（auth 也有自己的 Pool）
export const db = new Pool({
  connectionString: process.env.DATABASE_URL!,
});
