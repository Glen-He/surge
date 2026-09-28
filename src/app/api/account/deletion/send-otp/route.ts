import { getApiSession } from "@/features/session/api-session";
import {
  AccountVerificationError,
  accountVerificationErrorResponse,
} from "@/features/account/account-verification-errors";
import { sendCurrentAccountOtp } from "@/features/account/send-account-otp";

export async function POST() {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  try {
    const result = await sendCurrentAccountOtp({
      userId: session.user.id,
      email: session.user.email,
      purpose: "account_deletion",
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof AccountVerificationError) return accountVerificationErrorResponse(error);
    throw error;
  }
}
