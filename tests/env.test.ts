import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProductionEnvironment } from "@/lib/env";

describe("生产内容域环境约束", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@db/surge");
    vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
    vi.stubEnv("SHARE_SECRET", "b".repeat(32));
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
    expect(() => validateProductionEnvironment()).toThrow("独立主机名");

    vi.stubEnv("REPORTS_ORIGIN", "http://reports.glenhe.com");
    expect(() => validateProductionEnvironment()).toThrow("必须使用 HTTPS");
  });

  it("接受独立、无路径的 HTTPS 内容域", () => {
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    expect(() => validateProductionEnvironment()).not.toThrow();
  });
});
