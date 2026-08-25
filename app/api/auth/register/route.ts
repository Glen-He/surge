import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toChineseError } from "@/lib/auth-errors";
import { clientIp } from "@/lib/client-ip";
import { passwordPolicyError } from "@/lib/password-policy";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

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
 * 内部调用 better-auth handler 时的请求头代理：
 * origin/referer/cookie 必须转发——better-auth 的 CSRF 校验在请求带
 * cookie 时强制要求 Origin（见 end-session / 旧 guest-login 的踩坑记录）。
 */
function proxyHeaders(hs: Headers, cookie?: string): Headers {
  const h = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  });
  for (const [k, v] of hs.entries()) {
    if (/^(cookie|host|x-forwarded|origin|referer)$/i.test(k)) {
      h.set(k, v);
    }
  }
  h.set("x-forwarded-proto", hs.get("x-forwarded-proto") ?? "http");
  if (cookie) h.set("cookie", cookie);
  return h;
}

/**
 * 原子注册端点：OTP 验证 + 建号/登录 + 会话签发 + 初始密码，
 * 一次请求内由服务端全部完成。
 *
 * 取代原先客户端串两步（authClient.signIn.emailOtp → POST /api/set-password）
 * 的流程，消除「账号已建、会话已发、密码没存上」的半完成状态：
 * - 任何一步失败都不向浏览器下发会话 cookie，客户端保持未登录；
 * - 密码重试场景（上次响应在网络层丢失）：账号已存在且有密码时，
 *   setPassword 报 PASSWORD_ALREADY_SET，按成功放行，天然幂等；
 * - 服务端验证过的账号重走注册：OTP 即所有权证明，直接登录。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    email?: unknown;
    otp?: unknown;
    password?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  const pwdError = passwordPolicyError(password);
  if (pwdError) {
    return NextResponse.json({ error: pwdError }, { status: 400 });
  }
  if (!/^\d{6}$/.test(otp)) {
    return NextResponse.json({ error: "请输入 6 位验证码" }, { status: 400 });
  }

  const hs = await nextHeaders();
  const ip = clientIp(hs);
  if (!rateLimit(`register:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "操作过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  // 1) OTP 验证 + 建号/登录 + 签发会话（better-auth email-otp 插件内部端点，
  //    用户名由 auth.ts 的 before 钩子统一覆盖为随机 ID）
  const otpReq = new Request(`${baseUrl(hs)}/api/auth/sign-in/email-otp`, {
    method: "POST",
    headers: proxyHeaders(hs),
    body: JSON.stringify({ email, otp, name: "" }),
  });
  let otpRes: Response;
  try {
    otpRes = await auth.handler(otpReq);
  } catch (e) {
    logger.error("register", "sign-in/email-otp 失败", e as Error, { email });
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 },
    );
  }
  if (!otpRes.ok) {
    const j = (await otpRes.json().catch(() => null)) as {
      code?: string;
      message?: string;
    } | null;
    return NextResponse.json(
      { error: toChineseError(j ?? undefined) },
      { status: 400 },
    );
  }
  const setCookies =
    otpRes.headers.getSetCookie?.() ??
    (otpRes.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? []);
  // 浏览器还没拿到 cookie：从内部响应的 Set-Cookie 里取出新会话 cookie，
  // 供下一步 setPassword 以该会话身份执行
  const sessionCookie = setCookies
    .map((c) => c.split(";")[0])
    .find((p) => p.includes("session_token"));
  if (!sessionCookie) {
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 },
    );
  }

  // 2) 以新会话身份设置初始密码
  try {
    await auth.api.setPassword({
      body: { newPassword: password },
      headers: proxyHeaders(hs, sessionCookie),
    });
  } catch (err) {
    // 密码已存在 = 上一次注册实际已完成（响应丢失等），按成功放行
    const e = err as { body?: { code?: string }; code?: string };
    const code = e?.body?.code ?? e?.code ?? "";
    if (code !== "PASSWORD_ALREADY_SET") {
      logger.error("register", "setPassword 失败", err as Error, { email });
      return NextResponse.json(
        { error: "注册失败，请稍后重试" },
        { status: 500 },
      );
    }
  }

  // 3) 把内部响应的会话 cookie 原样下发给浏览器
  const resp = NextResponse.json({ ok: true });
  for (const sc of setCookies) {
    resp.headers.append("set-cookie", sc);
  }
  return resp;
}
