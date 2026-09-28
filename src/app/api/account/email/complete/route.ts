import { getApiSession } from "@/features/session/api-session";
import { finishEmailChange } from "@/features/account/finish-email-change";
import {
  AccountVerificationError,
  accountVerificationErrorResponse,
} from "@/features/account/account-verification-errors";
import { isOtpCode } from "@/features/auth/otp-code";
import { NEW_EMAIL_OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const token = typeof body?.emailChangeToken === "string" ? body.emailChangeToken : "";
  const newEmail = typeof body?.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
  const otp = typeof body?.otp === "string" ? body.otp : "";
  if (!token) {
    return accountVerificationErrorResponse(
      new AccountVerificationError("EMAIL_CHANGE_PROOF_REQUIRED"),
    );
  }
  if (!isOtpCode(otp)) {
    return Response.json({ error: NEW_EMAIL_OTP_CODE_FORMAT_ERROR }, { status: 400 });
  }
  try {
    await finishEmailChange({
      userId: session.user.id,
      currentEmail: session.user.email,
      currentSessionId: session.session.id,
      token,
      newEmail,
      otp,
    });
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof AccountVerificationError) {
      return accountVerificationErrorResponse(error);
    }
    throw error;
  }
}
