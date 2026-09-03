import { db } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/logging/logger";
import {
  GUEST_EMAIL_DOMAIN,
  guestOtpResponse,
  isGuestEmail,
} from "@/features/auth/guest/guest-identity";
import { checkOtpRateLimit, recordOtpSent } from "@/features/auth/otp-rate-limit";
import { sendOtpMail } from "@/features/auth/send-otp-mail";
import { accountOtpEmail, type AccountOtpEmailPurpose } from "./account-emails";
import { AccountOtpError } from "./account-otp-errors";
import { getChangeToken } from "./change-tokens";
import { generateAndStoreOtp } from "./otp";
import { logSecurity } from "@/features/security-audit/security-log";

type CurrentEmailOtpPurpose = Extract<
  AccountOtpEmailPurpose,
  "old_email" | "password_change" | "account_deletion"
>;

const PURPOSE_CONFIG: Record<
  CurrentEmailOtpPurpose,
  {
    storagePurpose: string;
    auditAction: string;
    exposeGuestOtp: boolean;
    exposeRemainingToday: boolean;
  }
> = {
  old_email: {
    storagePurpose: "email_change_old",
    auditAction: "OTP_SENT_EMAIL_CHANGE_OLD",
    exposeGuestOtp: false,
    exposeRemainingToday: true,
  },
  password_change: {
    storagePurpose: "password_change",
    auditAction: "OTP_SENT_PASSWORD",
    exposeGuestOtp: true,
    exposeRemainingToday: true,
  },
  account_deletion: {
    storagePurpose: "account_deletion",
    auditAction: "OTP_SENT_DELETION",
    exposeGuestOtp: true,
    exposeRemainingToday: false,
  },
};

function throwRateLimit(rate: Awaited<ReturnType<typeof checkOtpRateLimit>>): never {
  if (rate.ok) throw new Error("rate limit result is unexpectedly allowed");
  if (rate.reason === "daily_limit") {
    throw new AccountOtpError("OTP_DAILY_LIMIT", {
      retryAfter: rate.retryAfter,
    });
  }
  throw new AccountOtpError("OTP_COOLDOWN", {
    retryAfter: rate.retryAfter,
  });
}

async function sendCode(input: {
  email: string;
  emailPurpose: AccountOtpEmailPurpose;
  storagePurpose: string;
  auditAction: string;
}) {
  const rate = await checkOtpRateLimit({ email: input.email });
  if (!rate.ok) throwRateLimit(rate);
  const code = await generateAndStoreOtp({
    email: input.email,
    purpose: input.storagePurpose,
  });
  const template = accountOtpEmail(input.emailPurpose, code);
  await sendOtpMail({
    to: input.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
    attachments: template.attachments,
  });
  await recordOtpSent(input.email, input.auditAction);
  return { rate, code };
}

/** 发送当前账号邮箱的安全操作验证码。 */
export async function sendCurrentAccountOtp(input: {
  userId: string;
  email: string;
  purpose: CurrentEmailOtpPurpose;
}) {
  const config = PURPOSE_CONFIG[input.purpose];
  try {
    const { rate, code } = await sendCode({
      email: input.email,
      emailPurpose: input.purpose,
      ...config,
    });
    await logSecurity({ userId: input.userId, action: config.auditAction });
    return {
      success: true as const,
      retryAfter: rate.retryAfter,
      ...(config.exposeRemainingToday
        ? { remainingToday: rate.remainingToday }
        : {}),
      ...(config.exposeGuestOtp ? guestOtpResponse(input.email, code) : {}),
    };
  } catch (error) {
    if (error instanceof AccountOtpError) throw error;
    logger.error("account-otp", "failed to send account otp", error as Error, {
      userId: input.userId,
      purpose: input.purpose,
    });
    throw new AccountOtpError("ACCOUNT_OTP_SEND_FAILED");
  }
}

/** 验证换绑前置凭证与邮箱占用后，发送新邮箱验证码。 */
export async function sendNewEmailOtp(input: {
  userId: string;
  originalEmail: string;
  changeToken: string;
  newEmail: string;
}) {
  if (!input.changeToken) {
    throw new AccountOtpError("EMAIL_CHANGE_PROOF_REQUIRED");
  }
  if (!input.newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.newEmail)) {
    throw new AccountOtpError("EMAIL_INVALID");
  }
  const change = await getChangeToken(
    input.changeToken,
    input.userId,
    "email_change",
  );
  if (!change) throw new AccountOtpError("EMAIL_CHANGE_PROOF_EXPIRED");
  if (input.newEmail === input.originalEmail.toLowerCase()) {
    throw new AccountOtpError("EMAIL_UNCHANGED");
  }
  if (isGuestEmail(input.originalEmail) && !isGuestEmail(input.newEmail)) {
    throw new AccountOtpError("GUEST_EMAIL_DOMAIN_REQUIRED", {
      domain: GUEST_EMAIL_DOMAIN,
    });
  }
  const existing = await db.query(
    `SELECT 1 FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
    [input.newEmail],
  );
  if (existing.rows[0]) throw new AccountOtpError("EMAIL_ALREADY_USED");

  try {
    const { rate } = await sendCode({
      email: input.newEmail,
      emailPurpose: "new_email",
      storagePurpose: "email_change_new",
      auditAction: "OTP_SENT_EMAIL_CHANGE_NEW",
    });
    return {
      success: true as const,
      retryAfter: rate.retryAfter,
      remainingToday: rate.remainingToday,
    };
  } catch (error) {
    if (error instanceof AccountOtpError) throw error;
    logger.error("account-otp", "failed to send new email otp", error as Error, {
      userId: input.userId,
    });
    throw new AccountOtpError("ACCOUNT_OTP_SEND_FAILED");
  }
}
