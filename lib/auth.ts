import { randomUUID } from "crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
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
  isGuestEmail,
} from "./guest-sandbox";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const auth = betterAuth({
  // 官方建议：生产环境显式配置 baseURL（读 BETTER_AUTH_URL），
  // 不依赖请求头推断，避免反代场景下 origin/cookie 属性误判
  baseURL: process.env.BETTER_AUTH_URL,

  database: new Pool({
    connectionString: process.env.DATABASE_URL!,
  }),

  // 匿名访客签发限流：每次都会创建一次性账号 + 沙箱数据（5 张卡片 +
  // 磁盘目录），同 IP 10 分钟最多 5 次（沿用原 guest-login 路由的额度）
  rateLimit: {
    customRules: {
      "/sign-in/anonymous": { max: 5, window: 600 },
    },
  },

  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // 访客不设密码，重置链接无消费方，仅短路避免向假域名发信
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
      generateName: async () => "访客用户",
    }),
    emailOTP({
      // 用验证码邮件替代默认的验证链接邮件，避免双发
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        // 访客不走 better-auth OTP 邮件链路（自建路由已处理访客场景），仅短路防向假域名发信
        if (isGuestEmail(email)) return;
        // 发送成功后记录频控日志（注册 / 登录 / 找回密码等所有 better-auth OTP 都经过这里）
        await recordOtpSent(email, `OTP_SENT_${type ?? "GENERIC"}`);
        // better-auth change-email 端点已禁用，老用户/异常调用兜底走 new_email 模板；
        // 其余场景（sign-up / sign-in / forgot-password 等）走 login 通用验证码模板
        const tpl = renderOtpEmail(
          type === "change-email" ? "new_email" : "login",
          { code: otp },
        );
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
  ],

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
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
        // 访客邮箱免频控（不占每日 10 次配额、不占 60 秒冷却）
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
        }
      }
    }),
  },
});
