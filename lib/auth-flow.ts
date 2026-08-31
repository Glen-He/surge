import { toChineseError } from "@/lib/auth-errors";
import { passwordPolicyError } from "@/lib/password-policy";

export type AuthResult = { ok: true } | { ok: false; error: string };
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
 * 注册/游客仍由客户端认证接口完成，成功后做一次整页导航。
 * 密码登录不经过这里，已迁移到 Server Action，由服务端原子写 Cookie
 * 并 redirect，避免客户端 Cookie 提交时序问题。
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
      body: JSON.stringify({ email }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } | string; message?: string }
      | null;
    if (response.ok) return { ok: true };
    const raw = typeof data?.error === "string" ? data.error : data?.message;
    return {
      ok: false,
      error: raw && /[\u4e00-\u9fff]/.test(raw)
        ? raw
        : toChineseError(
            typeof data?.error === "object" ? data.error : { message: raw },
          ),
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
): Promise<AuthResult> {
  const pwdError = passwordPolicyError(password);
  if (pwdError) {
    return { ok: false, error: pwdError };
  }
  try {
    const res = await fetchWithTimeout("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp, password }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    if (!res.ok || !data?.ok) {
      const raw = typeof data?.error === "string" ? data.error : "";
      return {
        ok: false,
        error:
          raw && /[\u4e00-\u9fff]/.test(raw)
            ? raw
            : "注册失败，请稍后重试",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "网络异常，请稍后重试" };
  }
}

/**
 * 访客登录是一次原子服务端编排：匿名账号、固定 60 分钟租约、
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
        error:
          raw && /[\u4e00-\u9fff]/.test(raw)
            ? raw
            : "访客登录失败，请稍后重试",
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
          ? "访客登录超时，请重试"
          : "网络异常，请稍后重试",
    };
  }
}
