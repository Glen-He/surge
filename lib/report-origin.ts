function httpOrigin(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} only supports http/https`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain a username or password`);
  }
  return url.origin;
}

export function applicationOrigin(): string {
  const configured =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  return httpOrigin(configured?.trim() || "http://localhost:3000", "BETTER_AUTH_URL");
}

/**
 * 生产环境由 REPORTS_ORIGIN 指向独立、无 Cookie 的内容域；本地开发未配置时
 * 回退到主站 origin，避免要求开发机额外配置 DNS/反向代理。
 */
export function reportsOrigin(): string {
  const configured = process.env.REPORTS_ORIGIN?.trim();
  return configured
    ? httpOrigin(configured, "REPORTS_ORIGIN")
    : applicationOrigin();
}

export function reportDocumentUrl(capability: string): string {
  return new URL(
    `/r/${encodeURIComponent(capability)}/report.html`,
    reportsOrigin(),
  ).href;
}

/** 从可信反代头还原浏览器实际访问的 origin。 */
export function requestOrigin(req: Request): string {
  const requestUrl = new URL(req.url);
  const forwardedHost = req.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  // 优先使用反向代理覆盖后的 Host；仅在测试/特殊代理未提供 Host 时回退
  // x-forwarded-host。生产反代必须同时覆盖两者，不能透传客户端伪造值。
  const host = req.headers.get("host") || forwardedHost || requestUrl.host;
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const proto = forwardedProto || requestUrl.protocol.slice(0, -1);

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return "";
  }
}

export function isReportOriginRequest(req: Request): boolean {
  return requestOrigin(req) === reportsOrigin();
}
