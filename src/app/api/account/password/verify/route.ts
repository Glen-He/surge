import { auth } from "@/features/auth/auth";
import { getApiSession } from "@/features/session/api-session";
import {
  checkReauthenticationAllowed,
  clearReauthenticationFailures,
  recordReauthenticationFailure,
} from "@/features/auth/auth-attempts";
import { clientIp } from "@/infrastructure/security/client-ip";
import { PASSWORD_MAX } from "@/features/auth/password-policy";
import { createChangeToken } from "@/features/account/change-tokens";
import { logSecurity } from "@/features/security-audit/security-log";
import { verifyStoredOtp } from "@/features/account/otp";
import { isOtpCode } from "@/features/auth/otp-code";
import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

// 修改密码：验证身份（当前密码 或 邮箱验证码，二选一）
// 验证成功后签发一次性 password_change_token
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const method = body?.method === "otp" ? "otp" : "password";

  if (method === "password") {
    const password = String(body?.password ?? "");
    if (!password) {
      return Response.json({ error: "请输入当前密码" }, { status: 400 });
    }
    if (password.length > PASSWORD_MAX) {
      return Response.json({ error: "当前密码错误" }, { status: 400 });
    }
    const ip = clientIp(req.headers);
    const allowance = await checkReauthenticationAllowed(session.user.id, ip);
    if (!allowance.allowed) {
      return Response.json(
        { error: `尝试次数过多，请 ${allowance.retryAfter} 秒后再试` },
        { status: 429 },
      );
    }
    // verifyPassword 只校验当前凭据；与 signInEmail 不同，
    // 不会产生创建或轮换 session 的副作用。
    try {
      await auth.api.verifyPassword({
        body: { password },
        headers: req.headers,
      });
    } catch {
      await recordReauthenticationFailure(session.user.id, ip);
      return Response.json({ error: "当前密码错误" }, { status: 400 });
    }
    await clearReauthenticationFailures(session.user.id);
    await logSecurity({
      userId: session.user.id,
      action: "PASSWORD_VERIFY_BY_PASSWORD",
    });
  } else {
    const otp = String(body?.otp ?? "");
    if (!isOtpCode(otp)) {
      return Response.json(
        { error: OTP_CODE_FORMAT_ERROR },
        { status: 400 },
      );
    }
    const res = await verifyStoredOtp({
      email: session.user.email,
      purpose: "password_change",
      code: otp,
    });
    if (!res.ok) {
      return Response.json({ error: res.error }, { status: 400 });
    }
    await logSecurity({
      userId: session.user.id,
      action: "PASSWORD_VERIFY_BY_OTP",
    });
  }

  const token = await createChangeToken({
    userId: session.user.id,
    type: "password_change",
  });

  return Response.json({ success: true, passwordChangeToken: token });
}
