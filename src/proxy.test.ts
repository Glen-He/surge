import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mainContentSecurityPolicy, proxy } from "@/proxy";

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

  it("拒绝携带会话的跨站自定义写请求", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://glenhe.com");
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    const request = new NextRequest("https://glenhe.com/api/reports/x", {
      method: "DELETE",
      headers: {
        origin: "https://evil.example",
        cookie: "better-auth.session_token=secret",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(proxy(request).status).toBe(403);
  });

  it("允许同源写请求并主页签发每请求 CSP nonce", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://glenhe.com");
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    const mutation = new NextRequest("https://glenhe.com/api/reports/x", {
      method: "DELETE",
      headers: {
        origin: "https://glenhe.com",
        cookie: "better-auth.session_token=secret",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(proxy(mutation).status).toBe(200);

    const response = proxy(new NextRequest("https://glenhe.com/home"));
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-src https://reports.glenhe.com");
  });

  it("主站 CSP 不允许对象、跨站表单或被外站嵌入", () => {
    const csp = mainContentSecurityPolicy(
      "abc",
      "https://reports.glenhe.com",
      false,
    );
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("HSTS 只在配置为 HTTPS 的域名上下发", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://glenhe.com");
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.glenhe.com");
    expect(
      proxy(new NextRequest("https://glenhe.com/home")).headers.get(
        "strict-transport-security",
      ),
    ).toContain("max-age=");

    vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3000");
    vi.stubEnv("REPORTS_ORIGIN", "http://localhost:3000");
    const localResponse = proxy(
      new NextRequest("http://127.0.0.1:3000/home", {
        headers: { Host: "127.0.0.1:3000" },
      }),
    );
    expect(
      localResponse.headers.get("strict-transport-security"),
    ).toBeNull();
    expect(
      localResponse.headers.get("content-security-policy") ?? "",
    ).not.toContain("upgrade-insecure-requests");
  });
});
