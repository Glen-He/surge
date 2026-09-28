import { getApiSession } from "@/features/session/api-session";
import { verifyPasswordChange } from "@/features/account/verify-password-change";
import {
  AccountVerificationError,
  accountVerificationErrorResponse,
} from "@/features/account/account-verification-errors";

export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    const token = await verifyPasswordChange({
      userId: session.user.id,
      email: session.user.email,
      headers: req.headers,
      method: body?.method === "otp" ? "otp" : "password",
      password: String(body?.password ?? ""),
      otp: String(body?.otp ?? ""),
    });
    return Response.json({ success: true, passwordChangeToken: token });
  } catch (error) {
    if (error instanceof AccountVerificationError) {
      return accountVerificationErrorResponse(error);
    }
    throw error;
  }
}
