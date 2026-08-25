import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getApiSession } from "@/lib/api-session";
import { GUEST_EMAIL_DOMAIN, isGuestEmail } from "@/lib/guest-sandbox";
import {
  consumeChangeToken,
  getChangeToken,
  logSecurity,
  updateEmailWithVersion,
  verifyStoredOtp,
} from "@/lib/account";

export const dynamic = "force-dynamic";

// 完成修改邮箱：验证新邮箱验证码 → 多设备并发安全 UPDATE → 撤销其他会话
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const token = typeof body?.emailChangeToken === "string" ? body.emailChangeToken : "";
  const newEmail = typeof body?.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
  const otp = typeof body?.otp === "string" ? body.otp : "";

  if (!token) {
    return Response.json({ error: "请先验证当前邮箱" }, { status: 400 });
  }
  if (!otp) {
    return Response.json({ error: "请输入新邮箱验证码" }, { status: 400 });
  }

  const change = await getChangeToken(token, session.user.id, "email_change");
  if (!change) {
    return Response.json({ error: "验证已过期，请重新开始" }, { status: 400 });
  }
  const payload = change.payload as {
    originalEmail?: string;
    userVersion?: number;
  };

  // 校验请求中的新邮箱与 token 流程一致
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return Response.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (payload.originalEmail?.toLowerCase() !== session.user.email.toLowerCase()) {
    return Response.json({ error: "账号信息已经发生变化，请重新验证后再试" }, { status: 409 });
  }
  if (newEmail === session.user.email.toLowerCase()) {
    return Response.json({ error: "新邮箱不能与当前邮箱相同" }, { status: 400 });
  }
  // 访客模式：最终二次拦截，确保仍落在 @demo.surge 域内（防绕过）
  if (isGuestEmail(session.user.email) && !isGuestEmail(newEmail)) {
    return Response.json(
      { error: `访客模式暂不支持修改为真实邮箱，新邮箱需为 @${GUEST_EMAIL_DOMAIN} 域` },
      { status: 400 },
    );
  }

  // 验证新邮箱验证码
  const res = await verifyStoredOtp({
    email: newEmail,
    purpose: "email_change_new",
    code: otp,
  });
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: 400 });
  }

  if (!(await consumeChangeToken(token, session.user.id))) {
    return Response.json({ error: "验证已过期，请重新开始" }, { status: 400 });
  }

  // 多设备并发安全：仅当当前邮箱仍等于 originalEmail 且 version 未变化才更新
  const ok = await updateEmailWithVersion({
    userId: session.user.id,
    originalEmail: payload.originalEmail ?? session.user.email,
    expectedVersion: payload.userVersion ?? 0,
    newEmail,
  });
  if (!ok) {
    return Response.json({ error: "账号信息已经发生变化，请重新验证后再试" }, { status: 409 });
  }

  // 撤销其他设备的会话（当前设备保持登录）
  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch {
    // 撤销失败不影响修改结果
  }

  await logSecurity({ userId: session.user.id, action: "EMAIL_CHANGED" });

  return Response.json({ success: true });
}
