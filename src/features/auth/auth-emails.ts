import { OTP_CODE_LENGTH, OTP_TTL_SECONDS } from "./otp-code";
import {
  renderOtpEmail,
  renderResetPasswordEmail,
  type EmailRenderResult,
  type OtpEmailContent,
  type ResetPasswordEmailContent,
} from "@/infrastructure/email/render-email";

export const AUTH_EMAIL_FOOTER = "SURGE 工作汇报系统 · 自动发送，请勿回复";
export const OTP_EXPIRY_LABEL = `${OTP_TTL_SECONDS / 60} 分钟内有效`;

const SAFE_NOTE = "请勿向任何人透露验证码；非本人操作可忽略";

const LOGIN_OTP_CONTENT: OtpEmailContent = {
  subject: "你的 SURGE 登录验证码",
  expiryLabel: OTP_EXPIRY_LABEL,
  codeLabel: "验证码",
  footer: AUTH_EMAIL_FOOTER,
  preheader: `你的 SURGE 登录验证码为 {code}，${OTP_EXPIRY_LABEL}。`,
  title: "SURGE 工作汇报系统 · 登录验证码",
  headline: "登录验证码",
  context: "你正在登录 SURGE 工作汇报系统",
  note: SAFE_NOTE,
};

const RESET_PASSWORD_CONTENT: ResetPasswordEmailContent = {
  subject: "重置你的 SURGE 密码",
  footer: AUTH_EMAIL_FOOTER,
  preheader: "你请求了重置 SURGE 密码，链接 1 小时内有效。",
  title: "SURGE 工作汇报系统 · 重置密码",
  headline: "重置你的密码",
  context: "你请求了重置密码，请设置新密码",
  buttonLabel: "设置新密码",
  expiryLabel: "链接 1 小时内有效",
  fallbackIntro: "你请求了重置密码，请点击链接设置新密码（1 小时内有效）：",
  safetyNote: "非本人操作请忽略，你的账号是安全的",
};

/** 构建登录或注册流程使用的验证码邮件。 */
export function loginOtpEmail(code: string): EmailRenderResult {
  return renderOtpEmail(LOGIN_OTP_CONTENT, { code: code.padStart(OTP_CODE_LENGTH, "0") });
}

/** 构建密码重置链接邮件。 */
export function resetPasswordEmail(url: string): EmailRenderResult {
  return renderResetPasswordEmail(RESET_PASSWORD_CONTENT, { url });
}
