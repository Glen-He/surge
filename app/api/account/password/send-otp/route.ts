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

// 发送"修改密码"用的邮箱验证码（当前绑定邮箱）
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
          code:
            rl.reason === "daily_limit" ? "OTP_DAILY_LIMIT" : "OTP_COOLDOWN",
          retryAfter: rl.retryAfter,
        },
        { status: 429 },
      );
    }

    const code = await generateAndStoreOtp({
      email,
      purpose: "password_change",
    });
    const tpl = renderOtpEmail("password_change", { code });
    await sendOtpMail({
      to: email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
    });
    await recordOtpSent(email, "OTP_SENT_PASSWORD");
    await logSecurity({
      userId: session.user.id,
      action: "OTP_SENT_PASSWORD",
    });

    return Response.json({
      success: true,
      retryAfter: rl.retryAfter,
      remainingToday: rl.remainingToday,
      ...guestOtpResponse(email, code),
    });
  } catch (err) {
    // 详细错误只进服务端日志；响应体给通用文案，不向客户端泄露
    // SMTP 配置/内部栈等实现细节（debug 字段属于信息泄露，已移除）
    logger.error("send-otp/password", "发送失败", err as Error);
    return Response.json(
      { error: "验证码发送失败，请稍后重试" },
      { status: 500 },
    );
  }
}
