import { describe, expect, it, vi } from "vitest";
const consume = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/database/rate-limit", () => ({ consumeSharedRateLimit: consume }));
import { checkShareLookupRate } from "./share-lookup-rate";

describe("公开分享查询准入", () => {
  it("IP 跨 token 共用预算，封禁后不再反复查询数据库", async () => {
    consume.mockResolvedValueOnce({ allowed: true, retryAfter: 60 }).mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
    expect((await checkShareLookupRate("203.0.113.25", "abcd1234")).allowed).toBe(true);
    expect((await checkShareLookupRate("203.0.113.25", "abcd1234")).allowed).toBe(false);
    expect((await checkShareLookupRate("203.0.113.25", "abcd1234")).allowed).toBe(false);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenCalledWith("share-lookup", "203.0.113.25", 60, 60);
  });
});
