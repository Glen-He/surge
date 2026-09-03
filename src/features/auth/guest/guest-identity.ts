import {
  internalAuthProof,
  verifyInternalAuthProof,
} from "@/infrastructure/security/internal-auth-proof";

export const GUEST_EMAIL_DOMAIN = "demo.surge";
export const GUEST_TTL_MINUTES = 60;

export function isGuestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return String(email).toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

/** 生成仅供原子游客登录流程使用的内部凭证。 */
export function guestInternalProof(): string {
  return internalAuthProof("guest-login");
}

export function verifyGuestInternalProof(
  proof: string | null | undefined,
): boolean {
  return verifyInternalAuthProof("guest-login", "", proof);
}

/** 仅对游客邮箱返回由用户发码操作产生的页内验证码提示。 */
export function guestOtpResponse(email: string, code: string, ttlSec = 600) {
  if (!isGuestEmail(email)) return {};
  return {
    guestOtp: { code: String(code).padStart(6, "0"), expiresIn: ttlSec },
  };
}
