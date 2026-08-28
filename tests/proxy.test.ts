import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("独立报告内容域代理边界", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("内容域只允许 /r/*", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://glenhe.com");
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");

    const denied = proxy(new NextRequest("https://reports.glenhe.com/api/health"));
    expect(denied.status).toBe(404);

    const allowed = proxy(
      new NextRequest("https://reports.glenhe.com/r/CAP/report.html"),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
  });

  it("主站请求和同源本地开发不受影响", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://glenhe.com");
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    expect(proxy(new NextRequest("https://glenhe.com/home")).status).toBe(200);

    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("REPORTS_ORIGIN", "http://localhost:3000");
    expect(proxy(new NextRequest("http://localhost:3000/home")).status).toBe(200);
  });

  it("反代后以 Host 请求头而非 Next 内部 URL 判断内容域", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3217");
    vi.stubEnv("REPORTS_ORIGIN", "http://localhost:3217");

    const request = new NextRequest("http://0.0.0.0:3217/api/health", {
      headers: { Host: "localhost:3217" },
    });
    expect(proxy(request).status).toBe(404);
  });
});
