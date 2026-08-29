"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { toChineseError } from "@/lib/auth-errors";
import { logger } from "@/lib/logger";

export type PasswordLoginState = {
  error: string;
  submissionId: number;
};

function failed(error: string, submissionId: number): PasswordLoginState {
  return { error, submissionId };
}

function readableAuthError(error: unknown): string {
  if (!(error instanceof APIError)) return "登录失败，请稍后重试";
  const body = error.body as { code?: string; message?: string } | undefined;
  return toChineseError({
    code: body?.code,
    message: body?.message ?? error.message,
  });
}

/**
 * 密码登录的唯一 UI 入口。
 *
 * 凭据校验、HttpOnly 会话 Cookie 写入与页面跳转全部在同一次 Server
 * Action 响应中完成。FormData 始终视为不可信输入，错误只返回 UI 需要的
 * 中文文案，不返回认证库响应、用户记录或会话令牌。
 */
export async function passwordLoginAction(
  _previousState: PasswordLoginState,
  formData: FormData,
): Promise<PasswordLoginState> {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const submissionId = _previousState.submissionId + 1;

  if (!email || !password) return failed("请填写邮箱和密码", submissionId);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return failed("请输入有效的邮箱地址", submissionId);
  }

  try {
    await auth.api.signInEmail({
      body: { email, password, rememberMe: true },
      headers: await headers(),
    });
  } catch (error) {
    const apiError = error instanceof APIError ? error : null;
    logger.warn("password-login", "密码登录失败", {
      code: (apiError?.body as { code?: string } | undefined)?.code,
      status: apiError?.status,
    });
    return failed(readableAuthError(error), submissionId);
  }

  // redirect 是控制流异常，必须置于 catch 外；Cookie 已由 nextCookies 插件
  // 写入当前 Server Action 响应，目标页首个请求即可读到会话。
  redirect("/home");
}
