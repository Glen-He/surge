import { auth } from "@/features/auth/auth";
import {
  checkReauthenticationAllowed,
  clearReauthenticationFailures,
  recordReauthenticationFailure,
} from "@/features/auth/auth-attempts";
import { PASSWORD_MAX } from "@/features/auth/password-policy";
import { logSecurity } from "@/features/security-audit/security-log";
import { clientIp } from "@/infrastructure/security/client-ip";
import { AccountVerificationError } from "./account-verification-errors";
import { createChangeToken } from "./change-tokens";
import { verifyStoredOtp } from "./otp";

/** 校验当前凭据并签发一次性改密证明；失败计数与审计由同一业务流程维护。 */
export async function verifyPasswordChange(input: {
  userId: string;
  email: string;
  headers: Headers;
  method: "password" | "otp";
  password: string;
  otp: string;
}): Promise<string> {
  if (input.method === "password") {
    if (!input.password) throw new AccountVerificationError("PASSWORD_REQUIRED");
    if (input.password.length > PASSWORD_MAX) {
      throw new AccountVerificationError("PASSWORD_INCORRECT");
    }
    const ip = clientIp(input.headers);
    const allowance = await checkReauthenticationAllowed(input.userId, ip);
    if (!allowance.allowed) {
      throw new AccountVerificationError("PASSWORD_VERIFY_RATE_LIMIT", {
        retryAfter: allowance.retryAfter,
      });
    }
    // 只验证当前凭据，不使用会创建或轮换会话的登录接口。
    try {
      await auth.api.verifyPassword({
        body: { password: input.password },
        headers: input.headers,
      });
    } catch {
      await recordReauthenticationFailure(input.userId, ip);
      throw new AccountVerificationError("PASSWORD_INCORRECT");
    }
    await clearReauthenticationFailures(input.userId);
    await logSecurity({
      userId: input.userId,
      action: "PASSWORD_VERIFY_BY_PASSWORD",
    });
  } else {
    const result = await verifyStoredOtp({
      email: input.email,
      purpose: "password_change",
      code: input.otp,
    });
    if (!result.ok) throw result.error;
    await logSecurity({ userId: input.userId, action: "PASSWORD_VERIFY_BY_OTP" });
  }
  return createChangeToken({ userId: input.userId, type: "password_change" });
}
