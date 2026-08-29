import { authClient } from "@/lib/auth-client";
import { toChineseError } from "@/lib/auth-errors";
import { passwordPolicyError } from "@/lib/password-policy";

export type AuthResult = { ok: true } | { ok: false; error: string };
export type GuestResult =
  | { ok: true; ttlMinutes: number }
  | { ok: false; error: string };

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
  const { error } = await authClient.emailOtp.sendVerificationOtp({
    email,
    type: "sign-in",
  });
  return error
    ? { ok: false, error: toChineseError(error) }
    : { ok: true };
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
    const res = await fetch("/api/auth/register", {
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
 * 访客登录：认证交给 better-auth 官方 anonymous 客户端，
 * 业务沙箱（60 分钟过期 + 5 张示例卡片）交给 /api/guest-sandbox/init。
 * 认证与业务各自独立，不再手工转发认证协议头。
 */
export async function signInAsGuest(): Promise<GuestResult> {
  // 1) 官方客户端签发一次性访客账号 + 会话 cookie
  let { error } = await authClient.signIn.anonymous();
  if (error) {
    // 残留的访客会话（上次初始化中断）：清掉再来一次
    if (error.code === "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY") {
      try {
        await fetch("/api/auth/end-session", { method: "POST" });
      } catch {
        /* ignore */
      }
      ({ error } = await authClient.signIn.anonymous());
    }
    if (error) {
      return { ok: false, error: toChineseError(error) };
    }
  }

  // 2) 初始化访客沙箱（失败时服务端会销毁刚建的访客账号并回滚）
  try {
    const res = await fetch("/api/guest-sandbox/init", { method: "POST" });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; ttlMinutes?: number; error?: string }
      | null;
    if (!res.ok || !data?.ok) {
      await fetch("/api/auth/end-session", { method: "POST" }).catch(() => {});
      const raw = typeof data?.error === "string" ? data.error : "";
      return {
        ok: false,
        error:
          raw && /[\u4e00-\u9fff]/.test(raw)
            ? raw
            : "访客登录失败，请稍后重试",
      };
    }
    return { ok: true, ttlMinutes: Number(data.ttlMinutes) || 60 };
  } catch {
    await fetch("/api/auth/end-session", { method: "POST" }).catch(() => {});
    return { ok: false, error: "网络异常，请稍后重试" };
  }
}
