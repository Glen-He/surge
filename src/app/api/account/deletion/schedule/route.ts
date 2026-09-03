import { getApiSession } from "@/features/auth/api-session";
import { scheduleDeletion } from "@/features/account/account-deletion";
import { destroyGuestUser, isGuestEmail } from "@/features/auth/guest/guest-sandbox";
import { logger } from "@/infrastructure/logging/logger";
import { logSecurity } from "@/features/account/security-log";
import { verifyStoredOtp } from "@/features/account/otp";
import { isOtpCode } from "@/features/auth/otp-code";
import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

export const dynamic = "force-dynamic";

// 申请删除账号：必须先通过邮箱验证码，成功后进入 15 天冷却期（期内可取消）
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!isOtpCode(code)) {
    return Response.json(
      { error: OTP_CODE_FORMAT_ERROR },
      { status: 400 },
    );
  }

  const v = await verifyStoredOtp({
    email: session.user.email,
    purpose: "account_deletion",
    code,
  });
  if (!v.ok) {
    return Response.json({ error: v.error }, { status: 400 });
  }

  // 游客：跳过 15 天冷却，直接销毁沙箱（DB 级联 + 磁盘目录），前端按 redirectTo 跳登录
  if (isGuestEmail(session.user.email)) {
    try {
      await destroyGuestUser(session.user.id);
    } catch (error) {
      logger.error("deletion/schedule", "failed to destroy guest sandbox", error as Error, {
        userId: session.user.id,
      });
      return Response.json({ error: "删除失败，请重试" }, { status: 500 });
    }
    return Response.json({ ok: true, guestDestroyed: true, redirectTo: "/" });
  }

  if (!(await scheduleDeletion(session.user.id))) {
    return Response.json({ error: "账号已发生变化" }, { status: 409 });
  }
  await logSecurity({
    userId: session.user.id,
    email: session.user.email,
    action: "deletion_scheduled",
  });
  return Response.json({ ok: true });
}
