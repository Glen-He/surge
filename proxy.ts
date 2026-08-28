import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

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

/**
 * 第二道内容域收口：即便 OpenResty 被误配为整站反代，reports.glenhe.com
 * 也只能访问 /r/*。主站与内容域相同的本地开发环境不会启用此分支。
 */
export function proxy(request: NextRequest) {
  const appHost = hostname(process.env.BETTER_AUTH_URL);
  const reportsHost = hostname(process.env.REPORTS_ORIGIN);
  if (!appHost || !reportsHost || appHost === reportsHost) {
    return NextResponse.next();
  }

  // Next 在反向代理或 next start --hostname 0.0.0.0 下可能用内部监听地址
  // 构造 nextUrl，所以以 OpenResty 为当前 server block 设置的 Host 为准。
  // 不信任客户端可伪造的 X-Forwarded-Host。
  const requestHost =
    hostHeaderHostname(request.headers.get("host")) ??
    request.nextUrl.hostname.toLowerCase();
  if (requestHost !== reportsHost) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/r/")) {
    return NextResponse.next();
  }

  return new Response("not found", {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
