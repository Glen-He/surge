import { passwordPolicyError } from "@/features/auth/password-policy";
import { isOtpCode } from "@/features/auth/otp-code";
import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

export type AuthResult =
  | { ok: true }
  | { ok: false; error: string; field?: "inviteCode" };
export type GuestResult =
  | { ok: true; ttlMinutes: number; expiresAt: string }
  | { ok: false; error: string };

const AUTH_REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    AUTH_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 认证接口或 Server Action 确认成功并写入 Cookie 后，统一做一次整页导航。
 * 目标页通过新的文档请求读取会话，不依赖客户端路由缓存。
 */
export async function navigateAfterAuth(path: string): Promise<void> {
  window.location.assign(path);
}

/* ────────────────────────────────────────────────────────────
 * 认证流程（UI 只调这些函数，不感知协议细节）
 * ──────────────────────────────────────────────────────────── */

/** 注册第一步：发送验证码（sign-in 类型对未注册邮箱同样可用） */
export async function sendSignUpOtp(
  email: string,
  password: string,
  inviteCode: string,
): Promise<AuthResult> {
  // 密码规则必须拦在发码之前：验证通过即建号登录，
  // 规则不满足会导致「UI 提示失败、服务端 session 已建立」的状态分裂
  const pwdError = passwordPolicyError(password);
  if (pwdError) {
    return { ok: false, error: pwdError };
  }
  try {
    const response = await fetchWithTimeout("/api/auth/register/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, inviteCode }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    if (response.ok) return { ok: true };
    return {
      ok: false,
      error: typeof data?.error === "string"
        ? data.error
        : "验证码发送失败，请稍后重试",
      field: data?.code?.startsWith("INVITE_") ? "inviteCode" : undefined,
    };
  } catch {
    return { ok: false, error: "网络异常，请稍后重试" };
  }
}

/**
 * 注册第二步：OTP 验证 + 建号 + 登录 + 初始密码，
 * 由 /api/auth/register 服务端一次完成（原子注册）。
 * 任何一步失败浏览器都拿不到会话 cookie，不存在半完成状态。
 */
export async function registerWithOtp(
  email: string,
  otp: string,
  password: string,
  inviteCode: string,
): Promise<AuthResult> {
  if (!isOtpCode(otp)) {
    return { ok: false, error: OTP_CODE_FORMAT_ERROR };
  }
  const pwdError = passwordPolicyError(password);
  if (pwdError) {
    return { ok: false, error: pwdError };
  }
  try {
    const res = await fetchWithTimeout("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp, password, inviteCode }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; code?: string }
      | null;
    if (!res.ok || !data?.ok) {
      const raw = typeof data?.error === "string" ? data.error : "";
      return {
        ok: false,
        error: raw || "注册失败，请稍后重试",
        field: data?.code?.startsWith("INVITE_") ? "inviteCode" : undefined,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "网络异常，请稍后重试" };
  }
}

/**
 * 游客登录是一次原子服务端编排：匿名账号、固定 60 分钟租约、
 * 五个独立模板引用全部成功后才下发会话 Cookie。客户端不再经历
 * “先登录、再初始化”的半完成状态。
 */
export async function signInAsGuest(): Promise<GuestResult> {
  try {
    const res = await fetchWithTimeout("/api/auth/guest-login", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const data = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          ttlMinutes?: number;
          expiresAt?: string;
          error?: string;
        }
      | null;
    if (!res.ok || !data?.ok || !data.expiresAt) {
      const raw = typeof data?.error === "string" ? data.error : "";
      return {
        ok: false,
        error: raw || "游客登录失败，请稍后重试",
      };
    }
    return {
      ok: true,
      ttlMinutes: Number(data.ttlMinutes) || 60,
      expiresAt: data.expiresAt,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof DOMException && error.name === "AbortError"
          ? "游客登录超时，请重试"
          : "网络异常，请稍后重试",
    };
  }
}
