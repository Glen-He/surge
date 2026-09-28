import {
  GUEST_EMAIL_DOMAIN,
  isGuestEmail,
} from "@/features/auth/guest/guest-identity";
import { logSecurity } from "@/features/security-audit/security-log";
import { AccountVerificationError } from "./account-verification-errors";
import { completeEmailChange, getChangeToken } from "./change-tokens";
import { verifyStoredOtp } from "./otp";

/** 校验换绑策略与验证码，再原子核销证明、更新邮箱并撤销其他会话。 */
export async function finishEmailChange(input: {
  userId: string;
  currentEmail: string;
  currentSessionId: string;
  token: string;
  newEmail: string;
  otp: string;
}): Promise<void> {
  const change = await getChangeToken(input.token, input.userId, "email_change");
  if (!change) throw new AccountVerificationError("EMAIL_CHANGE_PROOF_EXPIRED");
  const payload = change.payload as { originalEmail?: string; userVersion?: number };
  if (!input.newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.newEmail)) {
    throw new AccountVerificationError("EMAIL_INVALID");
  }
  if (payload.originalEmail?.toLowerCase() !== input.currentEmail.toLowerCase()) {
    throw new AccountVerificationError("ACCOUNT_CHANGED");
  }
  if (input.newEmail === input.currentEmail.toLowerCase()) {
    throw new AccountVerificationError("EMAIL_UNCHANGED");
  }
  if (isGuestEmail(input.currentEmail) && !isGuestEmail(input.newEmail)) {
    throw new AccountVerificationError("GUEST_EMAIL_DOMAIN_REQUIRED", {
      domain: GUEST_EMAIL_DOMAIN,
    });
  }
  const otp = await verifyStoredOtp({
    email: input.newEmail,
    purpose: "email_change_new",
    code: input.otp,
  });
  if (!otp.ok) throw otp.error;
  const result = await completeEmailChange({
    token: input.token,
    userId: input.userId,
    currentSessionId: input.currentSessionId,
    originalEmail: payload.originalEmail ?? input.currentEmail,
    expectedVersion: payload.userVersion ?? 0,
    newEmail: input.newEmail,
  });
  if (result === "invalid-proof") {
    throw new AccountVerificationError("EMAIL_CHANGE_PROOF_EXPIRED");
  }
  if (result === "conflict") throw new AccountVerificationError("ACCOUNT_CHANGED");
  await logSecurity({ userId: input.userId, action: "EMAIL_CHANGED" });
}
