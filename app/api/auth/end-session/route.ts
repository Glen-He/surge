import { headers as nextHeaders, cookies as nextCookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { destroyGuestUser, isGuestEmail } from "@/lib/guest-sandbox";
import { logger } from "@/lib/logger";
import { ensureOtpMigration } from "@/lib/schema";

export const dynamic = "force-dynamic";

function baseUrl(hs: Headers): string {
  // 优先使用部署配置的固定地址（与 auth.baseURL 同源），
  // 避免内部调用 URL 的 host 取自客户端可控的转发头
  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL.replace(/\/+$/, "");
  }
  const host = hs.get("x-forwarded-host") ?? hs.get("host") ?? "localhost:3000";
  const proto = hs.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * 统一登出入口（访客 & 真实用户通用）：
 * 1) 先拿到当前 session 判断是不是访客
 * 2) 调 better-auth 默认 /sign-out 注销会话（转发 cookie）
 * 3) 若是访客：彻底销毁 DB 记录 + 磁盘报告目录（CASCADE 全清）
 * 前端所有"退出登录"按钮都应调此接口代替 authClient.signOut()。
 */
export async function POST() {
  await ensureOtpMigration();
  const hs = await nextHeaders();

  const session = await auth.api.getSession({ headers: hs });
  const guestId =
    session && isGuestEmail(session.user.email) ? session.user.id : null;

  // 1) 调用 better-auth 原生 sign-out，让它负责写 Set-Cookie 清空会话
  const signOutUrl = `${baseUrl(hs)}/api/auth/sign-out`;
  const proxyHeaders = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  });
  for (const [k, v] of hs.entries()) {
    if (/^(cookie|host|x-forwarded|origin|referer)$/i.test(k)) {
      proxyHeaders.set(k, v);
    }
  }
  proxyHeaders.set("x-forwarded-proto", hs.get("x-forwarded-proto") ?? "http");
  const signOutReq = new Request(signOutUrl, {
    method: "POST",
    headers: proxyHeaders,
    body: "{}",
  });
  let signOutResp: Response;
  try {
    signOutResp = await auth.handler(signOutReq as Request);
    await signOutResp.text(); // consume body
  } catch {
    signOutResp = new Response(null, { status: 204 });
  }

  // 2) 若是访客 → 销毁沙箱（删 user、级联 reports/sessions/otp_codes/account_changes、磁盘目录）
  if (guestId) {
    try { await destroyGuestUser(guestId); } catch (e) { logger.warn("end-session", "销毁访客沙箱失败", e as Error, { guestId }); }
  }

  // 3) 兜底：再清一次前端的 better-auth cookie（防止 handler 返回没有清除干净）
  //    ⚠️ 清理指令必须带 secure + sameSite 与主 cookie 一致：
  //    __Secure- 前缀的 Set-Cookie 若缺 Secure 属性，浏览器（尤其 Safari/WebKit）
  //    会拒绝整条指令，且同名多条 Set-Cookie 竞争会让 WebKit 的 cookie jar
  //    进入异常状态——随后登录响应的新 cookie 不被提交，表现为"登录要两次"。
  const resp = NextResponse.json({ ok: true });
  const setCookies =
    (signOutResp.headers as Headers).getSetCookie?.() ??
    ((signOutResp.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/)) ?? []);
  for (const sc of setCookies) resp.headers.append("set-cookie", sc);
  for (const c of (await nextCookies()).getAll()) {
    if (/better_auth|authjs|session/i.test(c.name)) {
      resp.cookies.set(c.name, "", {
        expires: new Date(0),
        path: "/",
        secure: true,
        sameSite: "lax",
      });
    }
  }
  return resp;
}
