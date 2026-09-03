import { randomUUID } from "crypto";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous, emailOTP } from "better-auth/plugins";
import { loginOtpEmail, resetPasswordEmail } from "./auth-emails";
import { authRequestPolicy } from "./auth-request-policy";
import { transporter } from "@/infrastructure/email/client";
import { recordOtpSent } from "./otp-rate-limit";
import { GUEST_EMAIL_DOMAIN, isGuestEmail } from "./guest/guest-identity";
import { createAuthDatabasePool } from "@/infrastructure/auth/auth-database";
import { serverEnv } from "@/infrastructure/environment/server";
import { OTP_CODE_LENGTH } from "./otp-code";

export const auth = betterAuth({
  // 官方建议：生产环境显式配置 baseURL（读 BETTER_AUTH_URL），
  // 不依赖请求头推断，避免反代场景下 origin/cookie 属性误判
  baseURL: serverEnv.BETTER_AUTH_URL,

  database: createAuthDatabasePool(),

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
      const tpl = resetPasswordEmail(url);
      await transporter.sendMail({
        from: serverEnv.SMTP_USER,
        to: user.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        attachments: [...tpl.attachments],
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
      // 往前取第一个非代理 IP（即真实客户端 IP，与 infrastructure/security/client-ip.ts 同语义）。
      trustedProxies: (serverEnv.TRUSTED_PROXIES ?? "127.0.0.1,::1")
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
      otpLength: OTP_CODE_LENGTH,
      // 用验证码邮件替代默认的验证链接邮件，避免双发
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        // 游客不走 better-auth OTP 邮件链路（自建路由已处理游客场景），仅短路防向假域名发信
        if (isGuestEmail(email)) return;
        // 发送成功后记录频控日志（注册 / 登录 / 找回密码等所有 better-auth OTP 都经过这里）
        await recordOtpSent(email, `OTP_SENT_${type ?? "GENERIC"}`);
        // 修改邮箱只走自建流程；better-auth OTP 统一使用登录验证码模板。
        const tpl = loginOtpEmail(otp);
        await transporter.sendMail({
          from: serverEnv.SMTP_USER,
          to: email,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
          attachments: [...tpl.attachments],
        });
      },
      // 修改邮箱由自建流程完成（/api/account/email/*），禁用插件内置端点，
      // 避免出现两套修改邮箱路径。
      changeEmail: {
        enabled: false,
      },
    }),
    // 官方 admin 插件提供持久化 role 与受保护的管理端点。项目自己的
    // 管理页面和 API 仍在 DAL 层逐次校验 admin role，默认拒绝访问。
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    // 必须放在最后：Server Action 直接调用 auth.api 时，将认证库返回的
    // Set-Cookie 写入 Next.js 的响应 cookie store。这样登录、写 cookie、
    // redirect 能在同一次服务端响应里完成，避免浏览器端请求后的提交竞态。
    nextCookies(),
  ],

  hooks: { before: authRequestPolicy },
});
