"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { auth } from "@/features/auth/auth";
import {
  checkPasswordLoginAllowed,
  clearPasswordLoginFailures,
  passwordLoginInternalProof,
  recordPasswordLoginFailure,
} from "@/features/auth/auth-attempts";
import { toChineseError } from "@/features/auth/auth-errors";
import { clientIp } from "@/infrastructure/security/client-ip";
import { logger } from "@/infrastructure/logging/logger";
import { PASSWORD_MAX } from "@/features/auth/password-policy";

export type PasswordLoginState =
  | { ok: false; error: string; submissionId: number }
  | { ok: true; error: ""; submissionId: number };

function failed(error: string, submissionId: number): PasswordLoginState {
  return { ok: false, error, submissionId };
}

function readableAuthError(error: unknown): string {
  if (!(error instanceof APIError)) return "登录失败，请稍后重试";
  const body = error.body as { code?: string } | undefined;
  return toChineseError({ code: body?.code });
}

/**
 * 密码登录的唯一 UI 入口。
 *
 * 凭据校验与 HttpOnly 会话 Cookie 写入在同一次 Server Action 响应中完成。
 * 成功后返回显式状态，由客户端在收到 Cookie 后执行整页导航。FormData
 * 始终视为不可信输入，错误只返回 UI 需要的中文文案，不返回认证库响应、
 * 用户记录或会话令牌。
 */
export async function passwordLoginAction(
  _previousState: PasswordLoginState,
  formData: FormData,
): Promise<PasswordLoginState> {
  const startedAt = Date.now();
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const submissionId = _previousState.submissionId + 1;

  if (!email || !password) return failed("请填写邮箱和密码", submissionId);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return failed("请输入有效的邮箱地址", submissionId);
  }
  // 本应用创建的账号都受 PASSWORD_MAX 约束。
  // 在触发故意昂贵的密码哈希（对存在与不存在的账号一视同仁）之前，
  // 先拒绝超长的攻击者输入。
  if (email.length > 320 || password.length > PASSWORD_MAX) {
    return failed("邮箱或密码错误", submissionId);
  }

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const allowance = await checkPasswordLoginAllowed(email, ip);
  if (!allowance.allowed) {
    return failed(
      `尝试次数过多，请 ${allowance.retryAfter} 秒后再试`,
      submissionId,
    );
  }

  try {
    const authHeaders = new Headers(requestHeaders);
    authHeaders.set("x-surge-password-login-proof", passwordLoginInternalProof(email));
    await auth.api.signInEmail({
      body: { email, password, rememberMe: true },
      headers: authHeaders,
    });
  } catch (error) {
    await recordPasswordLoginFailure(email, ip);
    const apiError = error instanceof APIError ? error : null;
    logger.warn("password-login", "password sign-in failed", {
      code: (apiError?.body as { code?: string } | undefined)?.code,
      status: apiError?.status,
      durationMs: Date.now() - startedAt,
    });
    return failed(readableAuthError(error), submissionId);
  }

  await clearPasswordLoginFailures(email);

  logger.info("password-login", "password sign-in completed", {
    durationMs: Date.now() - startedAt,
  });

  // Cookie 由 nextCookies 插件写入当前 Server Action 响应。返回成功状态后，
  // 客户端再执行整页导航，避免只依赖 RSC redirect 信号而出现已登录却未跳转。
  return { ok: true, error: "", submissionId };
}
