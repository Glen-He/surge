import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "@/infrastructure/database/client";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { clientIp } from "@/infrastructure/security/client-ip";
import { verifyInternalAuthProof } from "@/infrastructure/security/internal-auth-proof";
import { verifyPasswordLoginInternalProof } from "./auth-attempts";
import { isGuestEmail, verifyGuestInternalProof } from "./guest/guest-identity";
import { checkOtpRateLimit } from "./otp-rate-limit";
import { passwordPolicyError } from "./password-policy";
import {
  getRegistrationPolicy,
  verifyRegistrationInternalProof,
} from "./registration-policy";

/** 统一约束 Better Auth 原生端点，只保留平台定义的认证入口和安全策略。 */
export const authRequestPolicy = createAuthMiddleware(async (ctx) => {
  // 凭据与账号生命周期变更必须走自建路由：近期认证声明、冷却期、
  // 清理与会话撤销在路由内原子执行。Better Auth 原生端点否则会形成
  // 第二套更弱的策略面。
  if (
    ctx.path === "/change-password" ||
    ctx.path === "/change-email" ||
    ctx.path === "/delete-user"
  ) {
    throw new APIError("FORBIDDEN", {
      message: "请使用平台账号设置入口",
    });
  }
  if (
    ctx.path === "/set-password" &&
    !verifyInternalAuthProof(
      "set-password",
      "",
      ctx.headers?.get("x-surge-set-password-proof"),
    )
  ) {
    throw new APIError("FORBIDDEN", {
      message: "请使用平台注册入口",
    });
  }
  if (
    ctx.path === "/sign-out" &&
    !verifyInternalAuthProof(
      "end-session",
      "",
      ctx.headers?.get("x-surge-end-session-proof"),
    )
  ) {
    throw new APIError("FORBIDDEN", {
      message: "请使用平台退出登录入口",
    });
  }
  if (ctx.path === "/sign-in/email") {
    const email =
      typeof ctx.body?.email === "string"
        ? ctx.body.email.trim().toLowerCase()
        : "";
    if (
      !email ||
      !verifyPasswordLoginInternalProof(
        email,
        ctx.headers?.get("x-surge-password-login-proof"),
      )
    ) {
      throw new APIError("FORBIDDEN", {
        message: "请使用登录页完成登录",
      });
    }
  }
  if (
    ctx.path === "/sign-in/anonymous" &&
    !verifyGuestInternalProof(ctx.headers?.get("x-surge-guest-proof"))
  ) {
    throw new APIError("FORBIDDEN", {
      message: "请使用游客登录入口",
    });
  }

  // 本应用只支持一条建号路径：OTP 验证后在自建 /api/auth/register
  // 流程内事务化初始化密码。原生密码注册永远无效。
  if (ctx.path === "/sign-up/email") {
    throw new APIError("FORBIDDEN", { message: "请使用验证码注册" });
  }

  // Better Auth 原生 email/OTP 端点可能创建账号，因此新邮箱必须同时
  // 满足实时注册开关和服务端 HMAC proof。邀请码在自建路由内校验，
  // proof 只证明请求确实经过了该受控入口。
  const isOtpSignIn =
    ctx.path === "/sign-in/email-otp" ||
    (ctx.path === "/email-otp/send-verification-otp" &&
      (ctx.body?.type === "sign-in" || ctx.body?.type === "email-verification"));
  if (isOtpSignIn) {
    const email =
      typeof ctx.body?.email === "string"
        ? ctx.body.email.trim().toLowerCase()
        : "";
    if (email && !isGuestEmail(email)) {
      const existing = await db.query(
        `SELECT 1 FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
        [email],
      );
      if (!existing.rows[0]) {
        const policy = await getRegistrationPolicy();
        if (!policy.enabled) {
          throw new APIError("FORBIDDEN", {
            message: "当前未开放新账号注册",
          });
        }
        if (
          !verifyRegistrationInternalProof(
            email,
            ctx.headers?.get("x-surge-registration-proof"),
          )
        ) {
          throw new APIError("FORBIDDEN", { message: "请使用注册页完成注册" });
        }
      }
    }
  }

  // 用户首次注册时由服务端分配一个不可见的随机 ID 作为用户名。
  // sign-in/email-otp 只在用户不存在时才会用 name 建号，老用户不受影响。
  if (ctx.path === "/sign-up/email" || ctx.path === "/sign-in/email-otp") {
    return {
      context: {
        ...ctx,
        body: {
          ...ctx.body,
          name: `user_${crypto.randomUUID()}`,
        },
      },
    };
  }

  // reset-password 是 Better Auth 内置端点、不经过自建路由，密码策略必须
  // 在这里强制执行，否则直连 API 可绕过客户端校验设置弱密码。
  if (
    ctx.path === "/reset-password" ||
    ctx.path === "/email-otp/reset-password"
  ) {
    const password =
      typeof ctx.body?.newPassword === "string" ? ctx.body.newPassword : "";
    const passwordError = passwordPolicyError(password);
    if (passwordError) {
      throw new APIError("BAD_REQUEST", { message: passwordError });
    }
  }

  // 同一邮箱 60 秒最多 1 次、自然日最多 10 次；IP 与全局额度在数据库中
  // 跨实例共享。游客邮箱不发信，因此不占用这些额度。
  let otpEmail: string | undefined;
  if (ctx.path === "/email-otp/send-verification-otp") {
    otpEmail = ctx.body?.email;
  } else if (ctx.path === "/email-otp/request-email-change") {
    otpEmail = ctx.body?.newEmail;
  } else if (
    ctx.path === "/email-otp/request-password-reset" ||
    ctx.path === "/forget-password/email-otp" ||
    ctx.path === "/request-password-reset"
  ) {
    otpEmail = ctx.body?.email;
  }

  if (otpEmail && !isGuestEmail(otpEmail)) {
    const rate = await checkOtpRateLimit({ email: otpEmail });
    if (!rate.ok) {
      throw new APIError("TOO_MANY_REQUESTS", {
        message:
          rate.reason === "daily_limit"
            ? "今日验证码发送次数已达上限，请明天再试"
            : `请 ${rate.retryAfter} 秒后再试`,
      });
    }
    const sourceIp = clientIp(ctx.headers ?? new Headers());
    const [byIp, global] = await Promise.all([
      consumeSharedRateLimit("otp-send-ip", sourceIp, 30, 60 * 60),
      consumeSharedRateLimit("otp-send-global", "global", 1_000, 24 * 60 * 60),
    ]);
    if (!byIp.allowed || !global.allowed) {
      throw new APIError("TOO_MANY_REQUESTS", {
        message: "验证码发送过于频繁，请稍后再试",
      });
    }
  }
});
