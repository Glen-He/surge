import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { serverEnv } from "@/infrastructure/environment/server";
import { auth } from "@/features/auth/auth";
import { toChineseError } from "@/features/auth/auth-errors";
import { clientIp } from "@/infrastructure/security/client-ip";
import { passwordPolicyError } from "@/features/auth/password-policy";
import { logger } from "@/infrastructure/logging/logger";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import {
  getRegistrationPolicy,
  registrationInternalProof,
} from "@/features/auth/registration-policy";
import {
  inviteCodeHasValidFormat,
  normalizeInviteCode,
  redeemRegistrationInvite,
  validateRegistrationInvite,
} from "@/features/auth/registration-invites";
import { registrationErrorCopy } from "@/features/auth/registration-errors";
import { db } from "@/infrastructure/database/client";
import { internalAuthProof } from "@/infrastructure/security/internal-auth-proof";
import { isOtpCode } from "@/features/auth/otp-code";
import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

export const dynamic = "force-dynamic";

function baseUrl(hs: Headers): string {
  // 优先使用部署配置的固定地址（与 auth.baseURL 同源），
  // 避免内部调用 URL 的 host 取自客户端可控的转发头
  if (serverEnv.BETTER_AUTH_URL) {
    return serverEnv.BETTER_AUTH_URL.replace(/\/+$/, "");
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
    inviteCode?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const inviteCode = normalizeInviteCode(
    typeof body?.inviteCode === "string" ? body.inviteCode : "",
  );

  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  const pwdError = passwordPolicyError(password);
  if (pwdError) {
    return NextResponse.json({ error: pwdError }, { status: 400 });
  }
  if (!isOtpCode(otp)) {
    return NextResponse.json(
      { error: OTP_CODE_FORMAT_ERROR },
      { status: 400 },
    );
  }
  if (inviteCode && !inviteCodeHasValidFormat(inviteCode)) {
    return NextResponse.json(
      { code: "INVITE_FORMAT", error: registrationErrorCopy("INVITE_FORMAT") },
      { status: 400 },
    );
  }

  const hs = await nextHeaders();
  const ip = clientIp(hs);
  const registrationRate = await consumeSharedRateLimit("register", ip, 10, 10 * 60);
  if (!registrationRate.allowed) {
    return NextResponse.json(
      { error: "操作过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  // 同一邮箱的完整注册流程串行化：即使两台设备同时提交同一个 OTP，
  // 补偿清理也是安全的。
  const registrationClient = await db.connect();
  try {
    await registrationClient.query(
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      [`registration:${email.toLowerCase()}`],
    );
    const before = await registrationClient.query<{ id: string }>(
      `SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
      [email],
    );
    const userExisted = !!before.rows[0];
    const policy = await getRegistrationPolicy(registrationClient);
    if (!userExisted && !policy.enabled) {
      return NextResponse.json(
        { error: registrationErrorCopy("REGISTRATION_CLOSED") },
        { status: 403 },
      );
    }
    if (!userExisted && policy.inviteRequired && !inviteCode) {
      return NextResponse.json(
        { code: "INVITE_REQUIRED", error: registrationErrorCopy("INVITE_REQUIRED") },
        { status: 400 },
      );
    }
    if (
      !userExisted &&
      inviteCode &&
      !(await validateRegistrationInvite(inviteCode, registrationClient))
    ) {
      return NextResponse.json(
        { code: "INVITE_INVALID", error: registrationErrorCopy("INVITE_INVALID") },
        { status: 400 },
      );
    }

    // 1) OTP 验证 + 建号/会话创建。
    const otpHeaders = proxyHeaders(hs);
    otpHeaders.set("x-surge-registration-proof", registrationInternalProof(email));
    const otpReq = new Request(`${baseUrl(hs)}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: otpHeaders,
      body: JSON.stringify({ email, otp, name: "" }),
    });
    let otpRes: Response;
    try {
      otpRes = await auth.handler(otpReq);
    } catch (e) {
      logger.error("register", "sign-in/email-otp failed", e as Error, { email });
      return NextResponse.json(
        { error: "注册失败，请稍后重试" },
        { status: 500 },
      );
    }
    const otpData = (await otpRes.clone().json().catch(() => null)) as
      | { user?: { id?: string }; token?: string; code?: string }
      | null;
    if (!otpRes.ok) {
      return NextResponse.json(
        { error: toChineseError({ code: otpData?.code }) },
        { status: 400 },
      );
    }
    let createdUserId = otpData?.user?.id;
    if (!userExisted && !createdUserId) {
      const created = await registrationClient.query<{ id: string }>(
        `SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
        [email],
      );
      createdUserId = created.rows[0]?.id;
    }
    const setCookies =
      otpRes.headers.getSetCookie?.() ??
      (otpRes.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? []);
    const sessionCookie = setCookies
      .map((c) => c.split(";")[0])
      .find((p) => p.includes("session_token"));
    const sessionToken = otpData?.token ?? null;

    const compensate = async () => {
      if (!userExisted && createdUserId) {
        await registrationClient.query(`DELETE FROM "user" WHERE id = $1`, [createdUserId]);
      } else if (sessionToken) {
        await registrationClient.query(`DELETE FROM "session" WHERE token = $1`, [sessionToken]);
      }
    };

    if (!sessionCookie) {
      await compensate();
      return NextResponse.json(
        { error: "注册失败，请稍后重试" },
        { status: 500 },
      );
    }

    // 2) 设置初始密码。任何非幂等失败都会在响应离开本路由前完成补偿。
    try {
      const setPasswordHeaders = proxyHeaders(hs, sessionCookie);
      setPasswordHeaders.set(
        "x-surge-set-password-proof",
        internalAuthProof("set-password"),
      );
      await auth.api.setPassword({
        body: { newPassword: password },
        headers: setPasswordHeaders,
      });
    } catch (err) {
      const e = err as { body?: { code?: string }; code?: string };
      const code = e?.body?.code ?? e?.code ?? "";
      if (code !== "PASSWORD_ALREADY_SET") {
        await compensate();
        logger.error("register", "setPassword failed", err as Error, { email });
        return NextResponse.json(
          { error: "注册失败，请稍后重试" },
          { status: 500 },
        );
      }
    }

    // 3) 新账号使用邀请码时，最后一步才写入邀请归因。若邀请码在注册
    // 过程中被撤销，回滚本次新账号，浏览器不会收到会话 Cookie。
    if (!userExisted && inviteCode) {
      if (!createdUserId) {
        await compensate();
        return NextResponse.json(
          { error: "注册失败，请稍后重试" },
          { status: 500 },
        );
      }
      const redeemed = await redeemRegistrationInvite({
        client: registrationClient,
        code: inviteCode,
        userId: createdUserId,
      });
      if (!redeemed) {
        await compensate();
        return NextResponse.json(
          { code: "INVITE_INVALID", error: registrationErrorCopy("INVITE_INVALID") },
          { status: 400 },
        );
      }
    }

    // 4) 只有完全初始化且已完成邀请码核销的账号才会拿到会话 cookie。
    const resp = NextResponse.json({ ok: true });
    for (const sc of setCookies) resp.headers.append("set-cookie", sc);
    return resp;
  } finally {
    await registrationClient
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        `registration:${email.toLowerCase()}`,
      ])
      .catch(() => {});
    registrationClient.release();
  }
}
