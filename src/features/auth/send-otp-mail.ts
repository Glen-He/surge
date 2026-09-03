import { transporter } from "@/infrastructure/email/client";
import { serverEnv } from "@/infrastructure/environment/server";
import { isGuestEmail } from "@/features/auth/guest/guest-sandbox";
import type { MailInlineAttachment } from "@/infrastructure/email/templates";

/**
 * 自建流程的统一 OTP 邮件出口（注册验证 + 账户变更验证）。
 * 游客不发真实邮件：验证码已由调用方的响应体（guestOtpResponse）直接返回。
 */
export async function sendOtpMail(opts: {
  to: string;
  subject: string;
  text: string;
  /** HTML 版本：可选，传入后以 multipart/alternative 发送（优先展示 HTML） */
  html?: string;
  /** CID inline 装饰图标：来自邮件模板渲染结果，与 html 内 cid: 引用一一对应 */
  attachments?: readonly MailInlineAttachment[];
}) {
  if (isGuestEmail(opts.to)) return;
  await transporter.sendMail({
    from: serverEnv.SMTP_USER,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    ...(opts.html ? { html: opts.html } : {}),
    ...(opts.attachments ? { attachments: [...opts.attachments] } : {}),
  });
}
