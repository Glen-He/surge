import { getApiSession } from "@/features/auth/api-session";
import { db } from "@/infrastructure/database/client";
import { renderOtpEmail } from "@/infrastructure/email/templates";
import { isGuestEmail, GUEST_EMAIL_DOMAIN } from "@/features/auth/guest/guest-sandbox";
import { checkOtpRateLimit, recordOtpSent } from "@/features/auth/otp-rate-limit";
import { generateAndStoreOtp } from "@/features/account/otp";
import { getChangeToken } from "@/features/account/change-tokens";
import { sendOtpMail } from "@/features/auth/send-otp-mail";

export const dynamic = "force-dynamic";

// 发送"新邮箱"验证码：必须携带 email_change_token
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const token = typeof body?.emailChangeToken === "string" ? body.emailChangeToken : "";
  const newEmail = typeof body?.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";

  if (!token) {
    return Response.json({ error: "请先验证当前邮箱" }, { status: 400 });
  }
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return Response.json({ error: "邮箱格式不正确" }, { status: 400 });
  }

  // token 必须有效且属于当前用户
  const change = await getChangeToken(token, session.user.id, "email_change");
  if (!change) {
    return Response.json({ error: "验证已过期，请重新开始" }, { status: 400 });
  }

  const originalEmail = session.user.email;
  if (newEmail === originalEmail.toLowerCase()) {
    return Response.json({ error: "新邮箱不能与当前邮箱相同" }, { status: 400 });
  }

  // 游客模式下禁止改成真实域名邮箱（防止误发 SMTP + 刷爆配额），只能继续保留 @demo.surge 域
  if (isGuestEmail(originalEmail) && !isGuestEmail(newEmail)) {
    return Response.json(
      { error: `游客模式暂不支持修改为真实邮箱，新邮箱需为 @${GUEST_EMAIL_DOMAIN} 域名` },
      { status: 400 },
    );
  }

  // 新邮箱不能已被他人占用（最终唯一性由数据库唯一索引兜底）
  const exists = await db.query<{ id: string }>(
    `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
    [newEmail],
  );
  if (exists.rows[0]) {
    return Response.json({ error: "该邮箱已被其他账号使用" }, { status: 400 });
  }

  // 新邮箱同样参与全服务频控（按新邮箱维度）
  const rl = await checkOtpRateLimit({ email: newEmail });
  if (!rl.ok) {
    return Response.json(
      {
        error:
          rl.reason === "daily_limit"
            ? "今日验证码发送次数已达上限，请明天再试"
            : `请 ${rl.retryAfter} 秒后再试`,
        code: rl.reason === "daily_limit" ? "OTP_DAILY_LIMIT" : "OTP_COOLDOWN",
        retryAfter: rl.retryAfter,
      },
      { status: 429 },
    );
  }

  const code = await generateAndStoreOtp({ email: newEmail, purpose: "email_change_new" });
  const tpl = renderOtpEmail("new_email", { code });
  await sendOtpMail({
    to: newEmail,
    subject: tpl.subject,
    text: tpl.text,
    html: tpl.html,
    attachments: tpl.attachments,
  });
  await recordOtpSent(newEmail, "OTP_SENT_EMAIL_CHANGE_NEW");

  return Response.json({
    success: true,
    retryAfter: rl.retryAfter,
    remainingToday: rl.remainingToday,
  });
}
