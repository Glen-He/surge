// better-auth 错误码 → 中文文案（框架默认返回英文 message，这里统一翻译）。
// 客户端流程层（lib/auth-flow.ts）与注册端点（app/api/auth/register）共用。
import { OTP_CODE_LENGTH } from "@/features/auth/otp-code";

export const OTP_CODE_FORMAT_ERROR = `请输入 ${OTP_CODE_LENGTH} 位验证码`;
export const NEW_EMAIL_OTP_CODE_FORMAT_ERROR =
  `请输入 ${OTP_CODE_LENGTH} 位新邮箱验证码`;

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码错误",
  USER_NOT_FOUND: "该邮箱尚未注册",
  INVALID_PASSWORD: "密码错误",
  EMAIL_NOT_VERIFIED: "邮箱尚未验证，请先完成验证",
  PASSWORD_TOO_SHORT: "密码长度不足",
  PASSWORD_TOO_LONG: "密码长度过长",
  USER_ALREADY_EXISTS: "该邮箱已注册，请直接登录",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "该邮箱已注册，请更换邮箱",
  INVALID_OTP: "验证码错误",
  OTP_EXPIRED: "验证码已过期，请重新获取",
  TOO_MANY_REQUESTS: "操作过于频繁，请稍后再试",
  RATE_LIMIT: "操作过于频繁，请稍后再试",
  INVALID_EMAIL: "邮箱格式不正确",
  INVALID_TOKEN: "链接无效，请重新发起重置",
  EXPIRED_TOKEN: "链接已过期，请重新发起重置",
};

export function toChineseError(
  error: { code?: string } | undefined,
  fallback = "操作失败，请稍后重试",
): string {
  if (!error) return fallback;
  if (error.code && AUTH_ERROR_MESSAGES[error.code]) {
    return AUTH_ERROR_MESSAGES[error.code];
  }
  return fallback;
}
