import { randomUUID } from "crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { anonymous, emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import nodemailer from "nodemailer";
import {
  renderOtpEmail,
  renderResetPasswordEmail,
} from "./email-templates";
import { checkOtpRateLimit, recordOtpSent } from "./account";
import {
  GUEST_EMAIL_DOMAIN,
  verifyGuestInternalProof,
  isGuestEmail,
} from "./guest-sandbox";
import { passwordPolicyError } from "./password-policy";
import { clientIp } from "./client-ip";
import { consumeSharedRateLimit } from "./db-rate-limit";
import { verifyPasswordLoginInternalProof } from "./auth-attempts";
import {
  registrationIsOpen,
  verifyRegistrationInternalProof,
} from "./registration-policy";
import { db } from "./db";
import { verifyInternalAuthProof } from "./internal-auth-proof";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const AUTH_DB_QUERY_TIMEOUT_MS = Number(
  process.env.AUTH_DB_QUERY_TIMEOUT_MS ?? 15_000,
);

export const auth = betterAuth({
  // 官方建议：生产环境显式配置 baseURL（读 BETTER_AUTH_URL），
  // 不依赖请求头推断，避免反代场景下 origin/cookie 属性误判
  baseURL: process.env.BETTER_AUTH_URL,

  database: new Pool({
    connectionString: process.env.DATABASE_URL!,
    // 与 lib/db.ts 同款超时兜底，防止认证请求在数据库抖动时挂死
    max: Number(process.env.DB_POOL_MAX ?? 10),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    query_timeout: AUTH_DB_QUERY_TIMEOUT_MS,
    statement_timeout: AUTH_DB_QUERY_TIMEOUT_MS,
    lock_timeout: Math.min(AUTH_DB_QUERY_TIMEOUT_MS, 5_000),
  }),

  // 匿名游客签发限流：每次都会创建一次性账号 + 沙箱数据（5 张卡片 +
  // 磁盘目录），同 IP 10 分钟最多 5 次（沿用原 guest-login 路由的额度）
  rateLimit: {
    customRules: {
      "/sign-in/anonymous": { max: 5, window: 600 },
    },
  },

  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // 游客不设密码，重置链接无消费方，仅短路避免向假域名发信
      if (isGuestEmail(user.email)) return;
      await recordOtpSent(user.email, "OTP_SENT_FORGET_PASSWORD");
      const tpl = renderResetPasswordEmail({ url });
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: user.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    },
  },

  // 会话有效期 30 天（配合前端 rememberMe 保持登录）
  session: {
    expiresIn: 60 * 60 * 24 * 30,
  },

  // 反代（OpenResty/nginx）后面的真实客户端 IP 解析：
  // 限流按客户端 IP 分桶，否则所有请求共用一个桶（启动警告也会消除）
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
      // 信任的反代地址（IP/CIDR，逗号分隔，默认本机反代）。
      // 反代 append 模式下 XFF 形如「伪造段, 真实IP」；不配置信任代理时
      // better-auth 遇多段头会直接放弃解析 -> 全站共享同一个限流桶，
      // 「同 IP 5 次/10 分钟」实际从未按 IP 生效。配置后从 XFF 末段
      // 往前取第一个非代理 IP（即真实客户端 IP，与 lib/client-ip 同语义）。
      trustedProxies: (process.env.TRUSTED_PROXIES ?? "127.0.0.1,::1")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },

  plugins: [
    anonymous({
      emailDomainName: GUEST_EMAIL_DOMAIN,
      generateRandomEmail: async () =>
        `guest_${randomUUID().replace(/-/g, "").slice(0, 10)}@${GUEST_EMAIL_DOMAIN}`,
      generateName: async () => "游客用户",
    }),
    emailOTP({
      // 用验证码邮件替代默认的验证链接邮件，避免双发
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        // 游客不走 better-auth OTP 邮件链路（自建路由已处理游客场景），仅短路防向假域名发信
        if (isGuestEmail(email)) return;
        // 发送成功后记录频控日志（注册 / 登录 / 找回密码等所有 better-auth OTP 都经过这里）
        await recordOtpSent(email, `OTP_SENT_${type ?? "GENERIC"}`);
        // 修改邮箱只走自建流程；better-auth OTP 统一使用登录验证码模板。
        const tpl = renderOtpEmail("login", { code: otp });
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: email,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
      },
      // 修改邮箱由自建流程完成（/api/account/email/*），禁用插件内置端点，
      // 避免出现两套修改邮箱路径。
      changeEmail: {
        enabled: false,
      },
    }),
    // 必须放在最后：Server Action 直接调用 auth.api 时，将认证库返回的
    // Set-Cookie 写入 Next.js 的响应 cookie store。这样登录、写 cookie、
    // redirect 能在同一次服务端响应里完成，避免浏览器端请求后的提交竞态。
    nextCookies(),
  ],

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
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
      // 关闭公开注册必须在 UI 与自建路由之下强制执行。Better Auth 原生
      // email/OTP 端点是公开的，否则邮箱不存在时仍可能直接建出用户。
      if (!registrationIsOpen()) {
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
              throw new APIError("FORBIDDEN", {
                message: "当前未开放新账号注册",
              });
            }
          }
        }
      } else {
        // 注册开放时，新用户 OTP 端点仍要求服务端专属 HMAC proof，
        // 防止绕过事务化自建路由、直接创建无密码的半成品账号。
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
            if (
              !existing.rows[0] &&
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

      // ── 重置密码的复杂度校验（客户端之外的服务端强制点）──
      // reset-password 是 better-auth 内置端点、不经过自建路由，
      // 密码策略必须在这里拦，否则直连 API 可设置纯数字等弱密码
      if (
        ctx.path === "/reset-password" ||
        ctx.path === "/email-otp/reset-password"
      ) {
        const pwd =
          typeof ctx.body?.newPassword === "string" ? ctx.body.newPassword : "";
        const pwdErr = passwordPolicyError(pwd);
        if (pwdErr) {
          throw new APIError("BAD_REQUEST", { message: pwdErr });
        }
      }

      // ── 统一验证码发送频控（覆盖注册 / 登录 / 找回密码等所有 better-auth OTP）──
      // 同一邮箱 60 秒最多 1 次 + 自然日最多 10 次，全部由服务器决定，跨设备生效。
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

      if (otpEmail) {
        // 游客邮箱免频控（不占每日 10 次配额、不占 60 秒冷却）
        if (!isGuestEmail(otpEmail)) {
          const rl = await checkOtpRateLimit({ email: otpEmail });
          if (!rl.ok) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message:
                rl.reason === "daily_limit"
                  ? "今日验证码发送次数已达上限，请明天再试"
                  : `请 ${rl.retryAfter} 秒后再试`,
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
      }
    }),
  },
});
