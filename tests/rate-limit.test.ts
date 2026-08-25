import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

// 时间可控：直接 mock Date.now
let now = 1_000_000;
vi.spyOn(Date, "now").mockImplementation(() => now);
afterEach(() => {
  now = 1_000_000;
});

describe("rateLimit 内存限流", () => {
  it("窗口内放行 max 次、之后拒绝", () => {
    const key = `t1:${Math.random()}`;
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(false);
  });

  it("窗口过期后重新放行", () => {
    const key = `t2:${Math.random()}`;
    rateLimit(key, 1, 60_000);
    expect(rateLimit(key, 1, 60_000)).toBe(false);
    now += 60_001;
    expect(rateLimit(key, 1, 60_000)).toBe(true);
  });

  it("不同 key 互不影响", () => {
    const a = `t3a:${Math.random()}`;
    const b = `t3b:${Math.random()}`;
    expect(rateLimit(a, 1, 60_000)).toBe(true);
    expect(rateLimit(b, 1, 60_000)).toBe(true);
    expect(rateLimit(a, 1, 60_000)).toBe(false);
    expect(rateLimit(b, 1, 60_000)).toBe(false);
  });
});
