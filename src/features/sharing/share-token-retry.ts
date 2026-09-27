import type { PoolClient } from "pg";

/** 唯一索引是最终裁决者；保存点让随机 token 碰撞不污染外层事务。 */
export async function withShareTokenRetry<T>(
  client: PoolClient,
  constraint: "report_shares_token_hash_unique" | "share_boards_token_hash_unique",
  attempt: () => Promise<T>,
): Promise<T> {
  for (let count = 0; count < 16; count++) {
    await client.query("SAVEPOINT share_token_attempt");
    try {
      const result = await attempt();
      await client.query("RELEASE SAVEPOINT share_token_attempt");
      return result;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT share_token_attempt");
      await client.query("RELEASE SAVEPOINT share_token_attempt");
      const failure = error as { code?: string; constraint?: string };
      if (failure.code !== "23505" || failure.constraint !== constraint) throw error;
    }
  }
  throw new Error("share token generation exhausted");
}
