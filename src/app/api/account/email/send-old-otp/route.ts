import { getApiSession } from "@/features/session/api-session";
import {
  AccountOtpError,
  accountOtpErrorResponse,
} from "@/features/account/account-otp-errors";
import { sendCurrentAccountOtp } from "@/features/account/send-account-otp";

export async function POST() {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  try {
    const result = await sendCurrentAccountOtp({
      userId: session.user.id,
      email: session.user.email,
      purpose: "old_email",
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof AccountOtpError) return accountOtpErrorResponse(error);
    throw error;
  }
}
