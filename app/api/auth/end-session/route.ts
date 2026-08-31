import { headers as nextHeaders, cookies as nextCookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { destroyGuestUser, isGuestEmail } from "@/lib/guest-sandbox";
import { logger } from "@/lib/logger";
import { internalAuthProof } from "@/lib/internal-auth-proof";

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
 * 统一登出入口（游客 & 真实用户通用）：
 * 1) 先拿到当前 session 判断是不是游客
 * 2) 游客先彻底销毁账号/数据/私有文件，成功后才清 cookie
 * 3) 真实用户交给 better-auth /sign-out 撤销会话
 * 前端所有"退出登录"按钮都应调此接口代替 authClient.signOut()。
 */
export async function POST() {
  const hs = await nextHeaders();

  const session = await auth.api.getSession({ headers: hs });
  const guestId =
    session && isGuestEmail(session.user.email) ? session.user.id : null;

  // 游客的“退出成功”必须等价于“数据已销毁”。若销毁失败，
  // 保留原会话并返回可重试错误，不再出现前端看似退出、后台数据仍存在。
  if (guestId) {
    try {
      await destroyGuestUser(guestId);
    } catch (error) {
      logger.error("end-session", "销毁游客沙箱失败", error as Error, {
        guestId,
      });
      return NextResponse.json({ error: "退出失败，请重试" }, { status: 503 });
    }
  }

  // 真实用户调用 better-auth 原生 sign-out，让它负责写 Set-Cookie。
  let signOutResp: Response | null = null;
  if (!guestId) {
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
    proxyHeaders.set(
      "x-forwarded-proto",
      hs.get("x-forwarded-proto") ?? "http",
    );
    proxyHeaders.set(
      "x-surge-end-session-proof",
      internalAuthProof("end-session"),
    );
    const signOutReq = new Request(signOutUrl, {
      method: "POST",
      headers: proxyHeaders,
      body: "{}",
    });
    try {
      signOutResp = await auth.handler(signOutReq as Request);
      await signOutResp.text(); // consume body
      if (!signOutResp.ok) {
        logger.error("end-session", "better-auth 服务端会话撤销失败", {
          status: signOutResp.status,
        });
        return NextResponse.json({ error: "退出失败，请重试" }, { status: 503 });
      }
    } catch (error) {
      logger.error("end-session", "better-auth 服务端会话撤销异常", error as Error);
      return NextResponse.json({ error: "退出失败，请重试" }, { status: 503 });
    }
  }

  // 兜底：再清一次前端的 better-auth cookie。
  //    Secure 必须与当前站点协议一致：生产 HTTPS 使用 Secure，本地 HTTP
  //    不使用，否则浏览器会拒绝本地的清理指令，留下无法覆盖的旧会话。
  const resp = NextResponse.json({ ok: true });
  const secureCookie = new URL(baseUrl(hs)).protocol === "https:";
  const setCookies = signOutResp
    ? signOutResp.headers.getSetCookie?.() ??
      (signOutResp.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? [])
    : [];
  for (const sc of setCookies) resp.headers.append("set-cookie", sc);
  for (const c of (await nextCookies()).getAll()) {
    if (/better_auth|authjs|session/i.test(c.name)) {
      resp.cookies.set(c.name, "", {
        expires: new Date(0),
        path: "/",
        secure: secureCookie,
        sameSite: "lax",
      });
    }
  }
  return resp;
}
