import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/infrastructure/logging/logger";

describe("结构化日志脱敏", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("错误消息中的分享路径、邮箱、IP 和 Bearer 令牌不会原样输出", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.stubEnv(
      "LOG_REDACTION_SECRET",
      "log-redaction-test-secret-at-least-32-characters",
    );
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error(
      "test",
      "failure",
      new Error(
        "GET /share/SecretShareToken /board/BoardSecret/item/id https://reports.example/report/CapSecret/report.html for person@example.test from 203.0.113.8 with Bearer abc123",
      ),
    );
    const line = String(write.mock.calls[0]?.[0] ?? "");
    expect(line).not.toContain("SecretShareToken");
    expect(line).not.toContain("BoardSecret");
    expect(line).not.toContain("CapSecret");
    expect(line).not.toContain("person@example.test");
    expect(line).not.toContain("203.0.113.8");
    expect(line).not.toContain("abc123");
    expect(line).toContain("[redacted]");
    expect(line).toContain("fp:");
  });
});

describe("敏感凭证脱敏", () => {
  afterEach(() => vi.restoreAllMocks());

  it("递归隐藏提取码和内部证明，同时清理链接片段和查询参数", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test", "failure", {
      passcode: "2Y83", nested: [{ proof: "internal-proof-value", pwd: "8X2A" }],
      url: "/share/abcdefgh#pwd=4Z9X", query: "/board/abcdefgh?passcode=7B2C&item=abcd",
    });
    const output = String(write.mock.calls[0]?.[0]);
    for (const secret of ["2Y83", "internal-proof-value", "8X2A", "4Z9X", "7B2C", "abcdefgh"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("item=abcd");
  });
});
