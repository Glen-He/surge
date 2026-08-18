import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  createChangeToken,
  logSecurity,
  verifyStoredOtp,
} from "@/lib/account";

export const dynamic = "force-dynamic";

// 修改密码：验证身份（当前密码 或 邮箱验证码，二选一）
// 验证成功后签发一次性 password_change_token
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
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
    // 用 signInEmail 验证当前密码
    try {
      await auth.api.signInEmail({
        body: { email: session.user.email, password },
        headers: req.headers,
      });
    } catch {
      return Response.json({ error: "当前密码错误" }, { status: 400 });
    }
    await logSecurity({
      userId: session.user.id,
      action: "PASSWORD_VERIFY_BY_PASSWORD",
    });
  } else {
    const otp = String(body?.otp ?? "");
    if (!otp) {
      return Response.json({ error: "请输入验证码" }, { status: 400 });
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
