// better-auth 错误码 → 中文文案（框架默认返回英文 message，这里统一翻译）。
// 客户端流程层（lib/auth-flow.ts）与注册端点（app/api/auth/register）共用。
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
};

export function toChineseError(
  error: { code?: string; message?: string } | undefined,
): string {
  if (!error) return "操作失败，请稍后重试";
  if (error.code && AUTH_ERROR_MESSAGES[error.code]) {
    return AUTH_ERROR_MESSAGES[error.code];
  }
  // 英文消息（better-auth 未知错误）不直接展示，统一中文兜底；
  // 服务端路由已翻译过的中文消息原样透传
  const msg = error.message ?? "";
  if (msg && /[\u4e00-\u9fff]/.test(msg)) return msg;
  return "操作失败，请稍后重试";
}
