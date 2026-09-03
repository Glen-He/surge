import {
  renderOtpEmail,
  type EmailRenderResult,
  type OtpEmailContent,
} from "@/infrastructure/email/render-email";

export type AccountOtpEmailPurpose =
  | "new_email"
  | "old_email"
  | "password_change"
  | "account_deletion";

const SAFE_NOTE = "请勿向任何人透露验证码；非本人操作可忽略";

const ACCOUNT_OTP_CONTENT: Record<AccountOtpEmailPurpose, OtpEmailContent> = {
  new_email: {
    subject: "验证你的 SURGE 新邮箱",
    preheader: "你的 SURGE 新邮箱验证码为 {code}，5 分钟内有效。",
    title: "新邮箱验证码",
    headline: "验证新邮箱",
    context: "你正在验证新的账号邮箱地址",
    note: SAFE_NOTE,
  },
  old_email: {
    subject: "确认你的 SURGE 当前邮箱",
    preheader: "你的 SURGE 当前邮箱验证码为 {code}，5 分钟内有效。",
    title: "旧邮箱验证码",
    headline: "确认当前邮箱",
    context: "你正在确认当前邮箱的归属",
    note: SAFE_NOTE,
  },
  password_change: {
    subject: "你的 SURGE 修改密码验证码",
    preheader: "你的 SURGE 修改密码验证码为 {code}，5 分钟内有效。",
    title: "修改密码验证码",
    headline: "修改登录密码",
    context: "你正在修改登录密码",
    note: SAFE_NOTE,
  },
  account_deletion: {
    subject: "你的 SURGE 删除账号验证码",
    preheader: "你的 SURGE 删除账号验证码为 {code}，5 分钟内有效。",
    title: "删除账号验证码",
    headline: "确认删除账号",
    context: "你正在申请删除账号，此操作不可恢复",
    note: "删除后数据将被永久清除；15 天内可取消",
  },
};

/** 构建账号安全流程使用的验证码邮件。 */
export function accountOtpEmail(
  purpose: AccountOtpEmailPurpose,
  code: string,
): EmailRenderResult {
  return renderOtpEmail(ACCOUNT_OTP_CONTENT[purpose], { code });
}
