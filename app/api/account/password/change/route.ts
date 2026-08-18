import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  consumeChangeToken,
  getChangeToken,
  logSecurity,
} from "@/lib/account";

export const dynamic = "force-dynamic";

// 设置新密码：必须携带 password_change_token
// 成功后撤销其他设备的会话（当前设备保持登录）
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.passwordChangeToken === "string" ? body.passwordChangeToken : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!token) {
    return Response.json({ error: "请先验证身份" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return Response.json({ error: "新密码至少 8 位" }, { status: 400 });
  }
  if (newPassword.length > 100) {
    return Response.json({ error: "密码过长" }, { status: 400 });
  }

  const change = await getChangeToken(token, session.user.id, "password_change");
  if (!change) {
    return Response.json({ error: "验证已过期，请重新开始" }, { status: 400 });
  }

  // hash 后更新密码（internalAdapter 直接写入的是 hash）
  const context = await auth.$context;
  const passwordHash = await context.password.hash(newPassword);
  await context.internalAdapter.updatePassword(session.user.id, passwordHash);

  // 一次性 token 立即作废
  await consumeChangeToken(token, session.user.id);

  // 其他设备会话失效，当前设备保持登录
  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch {
    // 撤销失败不影响修改结果
  }

  await logSecurity({ userId: session.user.id, action: "PASSWORD_CHANGED" });

  return Response.json({ success: true });
}
