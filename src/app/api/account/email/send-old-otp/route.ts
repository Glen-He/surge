import { getApiSession } from "@/features/auth/api-session";
import { renderOtpEmail } from "@/infrastructure/email/templates";
import { checkOtpRateLimit, recordOtpSent } from "@/features/auth/otp-rate-limit";
import { generateAndStoreOtp } from "@/features/account/otp";
import { logSecurity } from "@/features/account/security-log";
import { sendOtpMail } from "@/features/auth/send-otp-mail";

export const dynamic = "force-dynamic";

// 发送"修改邮箱"第一步：当前绑定邮箱验证码
// 只能使用当前绑定邮箱验证码（不允许密码验证修改邮箱）
export async function POST() {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  const email = session.user.email;

  // 频控：同一邮箱 60s 冷却 + 自然日 10 次（服务器决定，跨设备生效）
  const rl = await checkOtpRateLimit({ email });
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

  const code = await generateAndStoreOtp({ email, purpose: "email_change_old" });
  const tpl = renderOtpEmail("old_email", { code });
  await sendOtpMail({
    to: email,
    subject: tpl.subject,
    text: tpl.text,
    html: tpl.html,
    attachments: tpl.attachments,
  });
  await recordOtpSent(email, "OTP_SENT_EMAIL_CHANGE_OLD");
  await logSecurity({ userId: session.user.id, action: "OTP_SENT_EMAIL_CHANGE_OLD" });

  return Response.json({
    success: true,
    retryAfter: rl.retryAfter,
    remainingToday: rl.remainingToday,
  });
}
