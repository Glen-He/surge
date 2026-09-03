import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProductionEnvironment } from "@/infrastructure/environment/validate-production-env";

describe("生产内容域环境约束", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@db/surge");
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
    vi.stubEnv("API_TOKEN_ENCRYPTION_KEY", "t".repeat(32));
    vi.stubEnv("INVITE_CODE_SECRET", "i".repeat(32));
    vi.stubEnv("SHARE_SECRET", "b".repeat(32));
    vi.stubEnv("SHARE_TOKEN_ENCRYPTION_KEY", "f".repeat(32));
    vi.stubEnv("MAINTENANCE_SECRET", "c".repeat(32));
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("SMTP_USER", "surge@example.com");
    vi.stubEnv("SMTP_PASS", "secret");
    vi.stubEnv("BETTER_AUTH_URL", "https://glenhe.com");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("要求非本地主站配置独立 HTTPS 内容域", () => {
    vi.stubEnv("REPORTS_ORIGIN", "");
    expect(() => validateProductionEnvironment()).toThrow("REPORTS_ORIGIN");

    vi.stubEnv("REPORTS_ORIGIN", "https://glenhe.com");
    expect(() => validateProductionEnvironment()).toThrow("distinct from the main site");

    vi.stubEnv("REPORTS_ORIGIN", "http://reports.glenhe.com");
    expect(() => validateProductionEnvironment()).toThrow("must use HTTPS");
  });

  it("接受独立、无路径的 HTTPS 内容域", () => {
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    expect(() => validateProductionEnvironment()).not.toThrow();
  });

  it("要求独立的分享令牌加密根密钥", () => {
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    vi.stubEnv("SHARE_TOKEN_ENCRYPTION_KEY", "");
    expect(() => validateProductionEnvironment()).toThrow(
      "SHARE_TOKEN_ENCRYPTION_KEY",
    );
  });

  it("要求独立的 API 令牌加密根密钥", () => {
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    vi.stubEnv("API_TOKEN_ENCRYPTION_KEY", "");
    expect(() => validateProductionEnvironment()).toThrow(
      "API_TOKEN_ENCRYPTION_KEY",
    );
  });
});
