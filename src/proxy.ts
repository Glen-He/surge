import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { frameworkEnv, serverEnv } from "@/infrastructure/environment/server";

function hostname(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostHeaderHostname(value: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const CUSTOM_AUTH_MUTATIONS = [
  "/api/auth/end-session",
  "/api/auth/guest-login",
  "/api/auth/register",
];

function withTransportSecurity<T extends Response>(response: T, origin: string): T {
  if (new URL(origin).protocol === "https:") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=15552000; includeSubDomains",
    );
  }
  return response;
}

function isCustomBrowserMutation(pathname: string, method: string): boolean {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(method.toUpperCase())) {
    return false;
  }
  if (!pathname.startsWith("/api/")) return false;
  if (
    pathname.startsWith("/api/v1/") ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/internal/")
  ) {
    return false;
  }
  if (pathname.startsWith("/api/auth/")) {
    return CUSTOM_AUTH_MUTATIONS.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  }
  return true;
}

export function isTrustedMutationRequest(
  request: Pick<NextRequest, "headers" | "method"> & { nextUrl: { pathname: string } },
  expectedOrigin: string,
): boolean {
  if (!isCustomBrowserMutation(request.nextUrl.pathname, request.method)) return true;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }

  // 浏览器会话变更请求至少携带 Origin、Fetch Metadata 或 Referer 之一。
  // 无这些头的非浏览器客户端没有浏览器环境 cookie；
  // 公开的程序化访问应走 /api/v1 的 Bearer 凭证。
  return !!origin || fetchSite === "same-origin" || !!referer || !request.headers.get("cookie");
}

export function mainContentSecurityPolicy(
  nonce: string,
  reportsOrigin: string,
  development: boolean,
  secureTransport = true,
): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    `frame-src ${reportsOrigin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(!development && secureTransport ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * 第二道内容域收口：即便 OpenResty 被误配为整站反代，reports.glenhe.com
 * 也只能访问 /r/*（capability 命名空间）与 /platform/*（manifest 白名单的
 * 平台公共库）。主站与内容域相同的本地开发环境不会启用此分支。
 */
export function proxy(request: NextRequest) {
  const appUrl = serverEnv.BETTER_AUTH_URL;
  const reportsUrl = serverEnv.REPORTS_ORIGIN;
  const appHost = hostname(appUrl);
  const reportsHost = hostname(reportsUrl);
  const configuredAppOrigin = appUrl
    ? new URL(appUrl).origin
    : request.nextUrl.origin;
  const configuredReportsOrigin = reportsUrl
    ? new URL(reportsUrl).origin
    : configuredAppOrigin;

  // Next 在反向代理或 next start --hostname 0.0.0.0 下可能用内部监听地址
  // 构造 nextUrl，所以以 OpenResty 为当前 server block 设置的 Host 为准。
  // 不信任客户端可伪造的 X-Forwarded-Host。
  const requestHost =
    hostHeaderHostname(request.headers.get("host")) ??
    request.nextUrl.hostname.toLowerCase();
  const requestOrigin =
    reportsHost && requestHost === reportsHost
      ? configuredReportsOrigin
      : configuredAppOrigin;
  if (appHost && reportsHost && appHost !== reportsHost && requestHost === reportsHost) {
    if (
      request.nextUrl.pathname.startsWith("/r/") ||
      request.nextUrl.pathname.startsWith("/platform/")
    ) {
      return withTransportSecurity(NextResponse.next(), requestOrigin);
    }

    return withTransportSecurity(new Response("not found", {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    }), requestOrigin);
  }

  if (!isTrustedMutationRequest(request, configuredAppOrigin)) {
    return withTransportSecurity(
      Response.json({ error: "请求来源无效" }, { status: 403 }),
      requestOrigin,
    );
  }

  const pathname = request.nextUrl.pathname;
  const shouldApplyCsp =
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/r/") &&
    // 平台公共资源是公开 immutable 静态库，不套主站 nonce CSP
    !pathname.startsWith("/platform/") &&
    !pathname.startsWith("/_next/") &&
    pathname !== "/favicon.ico";
  if (!shouldApplyCsp) {
    return withTransportSecurity(NextResponse.next(), requestOrigin);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = mainContentSecurityPolicy(
    nonce,
    configuredReportsOrigin,
    frameworkEnv.NODE_ENV !== "production",
    new URL(configuredAppOrigin).protocol === "https:",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return withTransportSecurity(response, requestOrigin);
}
