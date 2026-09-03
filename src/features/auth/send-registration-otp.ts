import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import {
  internalAuthBaseUrl,
  internalAuthHeaders,
} from "@/infrastructure/auth/internal-auth-request";
import { auth } from "./auth";
import { RegistrationError } from "./registration-errors";
import {
  inviteCodeHasValidFormat,
  validateRegistrationInvite,
} from "./registration-invites";
import {
  getRegistrationPolicy,
  registrationInternalProof,
} from "./registration-policy";

/** 校验注册策略与邀请码后，通过受控 Better Auth 入口发送验证码。 */
export async function sendRegistrationOtp(input: {
  email: string;
  inviteCode: string;
  clientIp: string;
  requestUrl: string;
  headers: Headers;
}): Promise<void> {
  const policy = await getRegistrationPolicy();
  if (!policy.enabled) throw new RegistrationError("REGISTRATION_CLOSED");

  const [address, global] = await Promise.all([
    consumeSharedRateLimit("registration-otp-ip", input.clientIp, 8, 60 * 60),
    consumeSharedRateLimit("registration-otp-global", "global", 200, 24 * 60 * 60),
  ]);
  if (!address.allowed || !global.allowed) {
    throw new RegistrationError("REGISTRATION_OTP_RATE_LIMIT");
  }
  if (policy.inviteRequired && !input.inviteCode) {
    throw new RegistrationError("INVITE_REQUIRED");
  }
  if (input.inviteCode && !inviteCodeHasValidFormat(input.inviteCode)) {
    throw new RegistrationError("INVITE_FORMAT");
  }
  if (input.inviteCode && !(await validateRegistrationInvite(input.inviteCode))) {
    throw new RegistrationError("INVITE_INVALID");
  }

  const headers = internalAuthHeaders(input.headers);
  headers.set("x-surge-registration-proof", registrationInternalProof(input.email));
  const response = await auth.handler(
    new Request(
      `${internalAuthBaseUrl(input.requestUrl)}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: input.email, type: "sign-in" }),
      },
    ),
  );
  const data = (await response.json().catch(() => null)) as
    | { code?: string; error?: { code?: string } }
    | null;
  if (!response.ok) {
    throw new RegistrationError("AUTH_REGISTRATION_REJECTED", {
      authCode: data?.code ?? data?.error?.code ?? null,
    });
  }
}
