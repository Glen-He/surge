export const OTP_CODE_LENGTH = 6;

const OTP_CODE_PATTERN = /^\d{6}$/;

/** 只保留验证码中的数字，并限制为平台统一的 6 位长度。 */
export function normalizeOtpCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH);
}

/** 判断输入是否为平台接受的完整 6 位数字验证码。 */
export function isOtpCode(value: unknown): value is string {
  return typeof value === "string" && OTP_CODE_PATTERN.test(value);
}
