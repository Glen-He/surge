import { serverEnv } from "@/infrastructure/environment/server";

/** 取得服务端内部调用 Better Auth 的可信基址。 */
export function internalAuthBaseUrl(requestUrl: string): string {
  return (
    serverEnv.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? new URL(requestUrl).origin
  );
}

/** 只转发 Better Auth 校验来源和 Cookie 所需的请求头。 */
export function internalAuthHeaders(
  headers: Headers,
  cookie?: string,
): Headers {
  const result = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  });
  for (const [name, value] of headers.entries()) {
    if (
      /^(cookie|host|origin|referer|x-forwarded-(for|host|proto))$/i.test(name)
    ) {
      result.set(name, value);
    }
  }
  const configuredProtocol = new URL(
    serverEnv.BETTER_AUTH_URL ?? "http://localhost",
  ).protocol.slice(0, -1);
  result.set(
    "x-forwarded-proto",
    headers.get("x-forwarded-proto") ?? configuredProtocol,
  );
  if (cookie) result.set("cookie", cookie);
  return result;
}

/** 完整提取 Better Auth 响应中的多个 Set-Cookie。 */
export function authSetCookies(headers: Headers): string[] {
  return headers.getSetCookie();
}
