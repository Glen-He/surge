import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { scheduleDeletion } from "@/lib/account-deletion";
import { destroyGuestUser, isGuestEmail } from "@/lib/guest-sandbox";
import { logSecurity, verifyStoredOtp } from "@/lib/account";

export const dynamic = "force-dynamic";

// 申请删除账号：必须先通过邮箱验证码，成功后进入 15 天冷却期（期内可取消）
export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: "请输入 6 位验证码" }, { status: 400 });
  }

  const v = await verifyStoredOtp({
    email: session.user.email,
    purpose: "account_deletion",
    code,
  });
  if (!v.ok) {
    return Response.json({ error: v.error }, { status: 400 });
  }

  // 访客：跳过 15 天冷却，直接销毁沙箱（DB 级联 + 磁盘目录），前端按 redirectTo 跳登录
  if (isGuestEmail(session.user.email)) {
    try { await destroyGuestUser(session.user.id); } catch (e) { console.warn("[deletion/schedule] destroy", e); }
    return Response.json({ ok: true, guestDestroyed: true, redirectTo: "/" });
  }

  await scheduleDeletion(session.user.id);
  await logSecurity({
    userId: session.user.id,
    email: session.user.email,
    action: "deletion_scheduled",
  });
  return Response.json({ ok: true });
}
