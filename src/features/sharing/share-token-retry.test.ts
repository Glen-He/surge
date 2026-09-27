import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { withShareTokenRetry } from "./share-token-retry";

describe("分享 token 碰撞重试", () => {
  it("仅目标唯一约束冲突重试，并先恢复事务保存点", async () => {
    const query = vi.fn(async () => ({}));
    const attempt = vi.fn().mockRejectedValueOnce({ code: "23505", constraint: "report_shares_token_hash_unique" }).mockResolvedValue("newtoken");
    expect(await withShareTokenRetry({ query } as unknown as PoolClient, "report_shares_token_hash_unique", attempt)).toBe("newtoken");
    expect(query.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "SAVEPOINT share_token_attempt", "ROLLBACK TO SAVEPOINT share_token_attempt", "RELEASE SAVEPOINT share_token_attempt",
      "SAVEPOINT share_token_attempt", "RELEASE SAVEPOINT share_token_attempt",
    ]);
  });
  it("其他数据库错误原样抛出，不通过重试掩盖", async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    const failure = { code: "23505", constraint: "report_shares_pkey" };
    const attempt = vi.fn().mockRejectedValue(failure);
    await expect(withShareTokenRetry(client, "report_shares_token_hash_unique", attempt)).rejects.toBe(failure);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
