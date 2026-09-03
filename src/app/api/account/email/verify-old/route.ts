import { getApiSession } from "@/features/auth/api-session";
import { createChangeToken, getUserVersion } from "@/features/account/change-tokens";
import { logSecurity } from "@/features/account/security-log";
import { verifyStoredOtp } from "@/features/account/otp";
import { isOtpCode } from "@/features/auth/otp-code";
import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

export const dynamic = "force-dynamic";

// 验证当前邮箱验证码 → 服务器签发一次性 email_change_token
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const otp = typeof body?.otp === "string" ? body.otp : "";

  if (!isOtpCode(otp)) {
    return Response.json(
        { error: OTP_CODE_FORMAT_ERROR },
      { status: 400 },
    );
  }

  const email = session.user.email;
  const res = await verifyStoredOtp({
    email,
    purpose: "email_change_old",
    code: otp,
  });
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: 400 });
  }

  // 记录当前用户版本，用于最终修改时的并发安全校验
  const userVersion = await getUserVersion(session.user.id);

  const token = await createChangeToken({
    userId: session.user.id,
    type: "email_change",
    payload: {
      originalEmail: email,
      userVersion,
    },
  });

  await logSecurity({
    userId: session.user.id,
    action: "EMAIL_CHANGE_OLD_VERIFIED",
  });

  return Response.json({ success: true, emailChangeToken: token });
}
