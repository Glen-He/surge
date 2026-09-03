import { getApiSession } from "@/lib/api-session";
import { renderOtpEmail } from "@/lib/email-templates";
import { guestOtpResponse } from "@/lib/guest-sandbox";
import { logger } from "@/lib/logger";
import {
  checkOtpRateLimit,
  generateAndStoreOtp,
  logSecurity,
  recordOtpSent,
  sendOtpMail,
} from "@/lib/account";

export const dynamic = "force-dynamic";

// 发送"删除账号"用的邮箱验证码（当前绑定邮箱）
export async function POST() {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  const email = session.user.email;

  try {
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

    const code = await generateAndStoreOtp({
      email,
      purpose: "account_deletion",
    });
    const tpl = renderOtpEmail("account_deletion", { code });
    await sendOtpMail({
      to: email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      attachments: tpl.attachments,
    });
    await recordOtpSent(email, "OTP_SENT_DELETION");
    await logSecurity({
      userId: session.user.id,
      action: "OTP_SENT_DELETION",
    });

    return Response.json({
      success: true,
      retryAfter: rl.retryAfter,
      ...guestOtpResponse(email, code),
    });
  } catch (err) {
    logger.error("send-otp/deletion", "otp send failed", err as Error);
    return Response.json(
      { error: "验证码发送失败，请稍后重试" },
      { status: 500 },
    );
  }
}
