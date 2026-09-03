import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimit = vi.hoisted(() => ({
  clearSecurityFailures: vi.fn(),
  consumeSharedRateLimit: vi.fn(),
  isSecurityRateLimited: vi.fn(),
  recordSecurityFailure: vi.fn(),
}));

vi.mock("@/infrastructure/database/rate-limit", () => rateLimit);

import {
  checkUnlockRate,
  clearUnlockRate,
  recordUnlockFailure,
} from "@/features/sharing/report-share";

describe("分享提取码限流", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimit.isSecurityRateLimited.mockResolvedValue({
      limited: false,
      retryAfter: 0,
    });
    rateLimit.recordSecurityFailure.mockResolvedValue({
      limited: false,
      retryAfter: 600,
    });
    rateLimit.clearSecurityFailures.mockResolvedValue(undefined);
  });

  it("scrypt 前只预占 token+IP 准入桶，不把正常尝试记入全局失败桶", async () => {
    await expect(checkUnlockRate("share-token", "203.0.113.10")).resolves.toEqual({
      ok: true,
    });

    expect(rateLimit.isSecurityRateLimited).toHaveBeenCalledWith(
      "share-unlock-token-failures",
      "share-token",
      50,
    );
    expect(rateLimit.recordSecurityFailure).toHaveBeenCalledTimes(1);
    expect(rateLimit.recordSecurityFailure).toHaveBeenCalledWith(
      "share-unlock-attempt",
      "share-token:203.0.113.10",
      10,
      600,
    );
  });

  it("只有错误提取码才进入 token 全局失败桶", async () => {
    await expect(recordUnlockFailure("share-token")).resolves.toEqual({ ok: true });
    expect(rateLimit.recordSecurityFailure).toHaveBeenCalledWith(
      "share-unlock-token-failures",
      "share-token",
      50,
      600,
    );
  });

  it("成功后只清除当前 token+IP 的准入桶", async () => {
    await clearUnlockRate("share-token", "203.0.113.10");
    expect(rateLimit.clearSecurityFailures).toHaveBeenCalledWith(
      "share-unlock-attempt",
      "share-token:203.0.113.10",
    );
  });
});
