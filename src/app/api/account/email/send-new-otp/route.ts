import { getApiSession } from "@/features/session/api-session";
import {
  AccountVerificationError,
  accountVerificationErrorResponse,
} from "@/features/account/account-verification-errors";
import { sendNewEmailOtp } from "@/features/account/send-account-otp";

export async function POST(request: Request) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    emailChangeToken?: unknown;
    newEmail?: unknown;
  } | null;
  try {
    const result = await sendNewEmailOtp({
      userId: session.user.id,
      originalEmail: session.user.email,
      changeToken:
        typeof body?.emailChangeToken === "string" ? body.emailChangeToken : "",
      newEmail:
        typeof body?.newEmail === "string"
          ? body.newEmail.trim().toLowerCase()
          : "",
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof AccountVerificationError) return accountVerificationErrorResponse(error);
    throw error;
  }
}
