import { authClient } from "@/lib/auth-client";
import { toChineseError } from "@/lib/auth-errors";
import { markRelaunchIntent } from "@/lib/relaunch-marker";

export type AuthResult = { ok: true } | { ok: false; error: string };
export type GuestResult =
  | { ok: true; ttlMinutes: number }
  | { ok: false; error: string };

/* ────────────────────────────────────────────────────────────
 * Safari/WebKit 兼容层（与业务完全隔离）
 *
 * 已知现象：登录接口 200 后紧跟着整页跳转，Safari/WebKit 可能因为
 * cookie jar 提交时序导致导航请求不带会话 cookie，被服务端 307 弹回
 * 登录页（Chrome 未复现）。根因尚未拿到线上日志坐实，因此本层只做
 * 「等会话可读再跳 + 弹回后自动续跳」，并把诊断职责留给服务端
 * requireSession 的 bounce 日志，UI 与业务流程不感知这些细节。
 * ──────────────────────────────────────────────────────────── */

/** 轮询服务端直到会话可读（说明 cookie 已对服务端生效），超时返回 false */
export async function waitSessionReady(
  timeoutMs = 8000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // 原生 fetch 直连服务端（不经 better-auth 客户端的 cookie 缓存）
      const r = await fetch("/api/auth/get-session", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json().catch(() => null)) as
          | { session?: unknown }
          | null;
        if (j && j.session) return true;
      }
    } catch {
      /* 网络抖动等，继续重试 */
    }
    await new Promise((res) => setTimeout(res, 150));
  }
  return false;
}

/**
 * 登录成功后的整页跳转。先落「续跳」标记：若跳转被 307 弹回登录页，
 * 登录页重新 mount 时发现标记 → 原地轮询到会话就绪 → 自动再跳一次，
 * 用户无需手动点第二次。/home 成功落地时清掉标记（见
 * components/relaunch-clear.tsx），保证标记只在「认证成功 → 首次落地」
 * 之间存活。
 */
export async function navigateAfterAuth(path: string): Promise<void> {
  markRelaunchIntent();
  await waitSessionReady();
  window.location.assign(path);
}

/* ────────────────────────────────────────────────────────────
 * 认证流程（UI 只调这些函数，不感知协议细节）
 * ──────────────────────────────────────────────────────────── */

/** 密码登录（better-auth 官方客户端 API，cookie 由框架处理） */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  const { error } = await authClient.signIn.email({
    email,
    password,
    // 保持登录 30 天
    rememberMe: true,
  });
  return error
    ? { ok: false, error: toChineseError(error) }
    : { ok: true };
}

/** 注册第一步：发送验证码（sign-in 类型对未注册邮箱同样可用） */
export async function sendSignUpOtp(
  email: string,
  password: string,
): Promise<AuthResult> {
  // 密码规则必须拦在发码之前：验证通过即建号登录，
  // 规则不满足会导致「UI 提示失败、服务端 session 已建立」的状态分裂
  if (password.length < 8) {
    return { ok: false, error: "密码至少需要 8 位" };
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
  if (password.length < 8) {
    return { ok: false, error: "密码至少需要 8 位" };
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
    return { ok: false, error: "网络异常，请稍后重试" };
  }
}
