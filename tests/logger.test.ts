import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

describe("结构化日志脱敏", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("错误消息中的分享路径、邮箱、IP 和 Bearer 令牌不会原样输出", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.stubEnv("LOG_REDACTION_SECRET", "log-redaction-test-secret");
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error(
      "test",
      "failure",
      new Error(
        "GET /s/SecretShareToken for person@example.test from 203.0.113.8 with Bearer abc123",
      ),
    );
    const line = String(write.mock.calls[0]?.[0] ?? "");
    expect(line).not.toContain("SecretShareToken");
    expect(line).not.toContain("person@example.test");
    expect(line).not.toContain("203.0.113.8");
    expect(line).not.toContain("abc123");
    expect(line).toContain("[redacted]");
    expect(line).toContain("fp:");
  });
});
