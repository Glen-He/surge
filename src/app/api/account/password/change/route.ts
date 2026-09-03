import { auth } from "@/features/auth/auth";
import { getApiSession } from "@/features/session/api-session";
import { passwordPolicyError } from "@/features/auth/password-policy";
import { completePasswordChange } from "@/features/account/change-tokens";
import { logSecurity } from "@/features/security-audit/security-log";

// 设置新密码：必须携带 password_change_token
// 成功后撤销其他设备的会话（当前设备保持登录）
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.passwordChangeToken === "string" ? body.passwordChangeToken : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!token) {
    return Response.json({ error: "请先验证身份" }, { status: 400 });
  }
  const pwdError = passwordPolicyError(newPassword);
  if (pwdError) {
    return Response.json({ error: pwdError }, { status: 400 });
  }

  // 在事务外完成哈希，再在 PostgreSQL 内原子地：消费凭证、
  // 更新凭据并撤销其余全部会话。
  const context = await auth.$context;
  const passwordHash = await context.password.hash(newPassword);
  if (
    !(await completePasswordChange({
      token,
      userId: session.user.id,
      currentSessionId: session.session.id,
      passwordHash,
    }))
  ) {
    return Response.json({ error: "验证已过期，请重新开始" }, { status: 400 });
  }

  await logSecurity({ userId: session.user.id, action: "PASSWORD_CHANGED" });

  return Response.json({ success: true });
}
