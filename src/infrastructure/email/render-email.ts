import { readFileSync } from "node:fs";
import path from "node:path";

/* 邮件 HTML 渲染：Apple 风格一版式（2026-08 重设计 v3）
 *
 * 设计原则（对齐 Apple ID 验证码邮件 / apple.com 邮件语言）：
 * - 留白营造焦点：层级靠字重和间距，不靠色块与巨字号
 * - 验证码 28px 近黑 #1d1d1f（Apple 的红只用于错误警示，验证码不染红）
 * - 蓝色仅行动按钮 #0071e3 / 文字链 #0066cc，背景苹果灰 #f5f5f7
 * - 白卡片无边框无阴影，圆角 18px，靠背景色差分层
 * - 全端（320px ~ 桌面）同一版式，零媒体查询：Outlook / 剥离 <style> 的
 *   客户端（Gmail IMAP、部分国产 webmail）渲染完全一致
 * - 文案行宽按 320px 窄屏一行不折校准：场景句 ≤16 全角字符（15px）、脚注 ≤20（12px）
 *
 * 装饰图标（logo / 时钟）以 CID inline 附件随邮件本体发送：
 * HTML 引用 src="cid:..."，SMTP 层在 multipart/related 中携带 PNG 字节，
 * 收件人首次打开无需回源网站。CID 名称与附件定义集中在下方
 * MAIL_CID / MAIL_ATTACHMENTS，模板与发送层不得各自维护一套名称。
 */

/** nodemailer 内联附件（结构兼容，发送层直接透传给 sendMail） */
export type MailInlineAttachment = {
  filename: string;
  cid: string;
  content: Buffer;
  contentType: "image/png";
  contentDisposition: "inline";
};

export type EmailRenderResult = {
  subject: string;
  html: string;
  text: string;
  /** CID inline 装饰图标：与 html 内 cid: 引用一一对应，直接透传 sendMail */
  attachments: readonly MailInlineAttachment[];
};

/* ── CID inline 图标（单一来源）───────────────────────── */

/** CID 名称：HTML src 与附件 Content-ID 一一对应 */
const MAIL_CID = {
  emailIcon: "mail-icon-email@surge",
  clockIcon: "mail-icon-clock@surge",
} as const;

/** 图标文件随部署存在于 public/mail/（git 跟踪）；缺失时模块加载即抛错
 *  （fail-fast），不做任何远程 URL 回退——装饰图标不该在运行期兜底，
 *  部署缺资源这种错误要在启动期暴露。 */
function loadMailAsset(filename: string): Buffer {
  return readFileSync(path.join(process.cwd(), "public", "mail", filename));
}

/** 两份模板共用 logo + 时钟，进程内一次读入（约 6KB） */
const MAIL_ATTACHMENTS: readonly MailInlineAttachment[] = [
  {
    filename: "icon-email.png",
    cid: MAIL_CID.emailIcon,
    content: loadMailAsset("icon-email.png"),
    contentType: "image/png",
    contentDisposition: "inline",
  },
  {
    filename: "clock-email.png",
    cid: MAIL_CID.clockIcon,
    content: loadMailAsset("clock-email.png"),
    contentType: "image/png",
    contentDisposition: "inline",
  },
];

/* ── 共享骨架 ─────────────────────────────────────────── */

const HEAD_STYLE = `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background: #F5F5F7;
    }
    body, table, td, p, a {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    table {
      border-collapse: separate !important;
      border-spacing: 0 !important;
    }
    img {
      border: 0;
      outline: none;
      text-decoration: none;
      display: block;
      -ms-interpolation-mode: bicubic;
    }
    p { margin: 0; }
`;

const CLOCK_ICON = `<img src="cid:${MAIL_CID.clockIcon}" width="14" height="14" alt="" style="display:inline-block;border:0;vertical-align:-2px;">`;

/** 由业务 feature 提供的验证码邮件文案；基础设施层只负责安全渲染。 */
export type OtpEmailContent = {
  subject: string;
  preheader: string;
  title: string;
  headline: string;
  context: string;
  note: string;
};

/** 由 auth feature 提供的重置密码邮件文案。 */
export type ResetPasswordEmailContent = {
  subject: string;
  preheader: string;
  title: string;
  headline: string;
  context: string;
  buttonLabel: string;
  expiryLabel: string;
  fallbackIntro: string;
  safetyNote: string;
};

const FOOTER_TEXT = "SURGE 工作汇报系统 · 自动发送，请勿回复";

/* ── HTML 渲染 ─────────────────────────────────────────── */

function renderOtpHtml(meta: OtpEmailContent, code: string): string {
  const preheader = meta.preheader.replaceAll("{code}", code);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>SURGE 工作汇报系统 · ${meta.title}</title>
  <style>${HEAD_STYLE}  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F5F5F7;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:18px;">
          <tr>
            <td align="center" style="padding:48px 28px 0;">
              <img src="cid:${MAIL_CID.emailIcon}" width="28" height="28" alt="" style="display:block;margin:0 auto;border:0;">
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 28px 0;">
              <h1 style="margin:0;color:#1D1D1F;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.3px;">${meta.headline}</h1>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 28px 0;">
              <p style="margin:0;color:#6E6E73;font-size:15px;line-height:24px;">${meta.context}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:40px 28px 0;">
              <div style="margin:0 -7px 0 0;color:#1D1D1F;font-family:-apple-system,'SF Mono','SFMono-Regular',Consolas,Menlo,monospace;font-size:28px;line-height:36px;font-weight:600;letter-spacing:7px;white-space:nowrap;font-variant-numeric:tabular-nums;">${code}</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:14px 28px 0;">
              <p style="margin:0;color:#6E6E73;font-size:13px;line-height:22px;">${CLOCK_ICON}&nbsp;5 分钟内有效</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:48px 28px 0;">
              <p style="margin:0;color:#86868B;font-size:12px;line-height:20px;">${meta.note}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 28px 44px;">
              <p style="margin:0;color:#86868B;font-size:11px;line-height:18px;">${FOOTER_TEXT}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* 重置密码场景：点击链接型 */
function renderResetHtml(meta: ResetPasswordEmailContent, url: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>SURGE 工作汇报系统 · ${meta.title}</title>
  <style>${HEAD_STYLE}  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${meta.preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F5F5F7;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:18px;">
          <tr>
            <td align="center" style="padding:48px 28px 0;">
              <img src="cid:${MAIL_CID.emailIcon}" width="28" height="28" alt="" style="display:block;margin:0 auto;border:0;">
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 28px 0;">
              <h1 style="margin:0;color:#1D1D1F;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.3px;">${meta.headline}</h1>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 28px 0;">
              <p style="margin:0;color:#6E6E73;font-size:15px;line-height:24px;">${meta.context}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:36px 28px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td bgcolor="#0071E3" style="border-radius:999px;padding:13px 44px;">
                    <a href="${url}" style="color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;">${meta.buttonLabel}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 28px 0;">
              <p style="margin:0;color:#6E6E73;font-size:13px;line-height:22px;">${CLOCK_ICON}&nbsp;${meta.expiryLabel}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:12px 28px 0;">
              <p style="margin:0;font-size:12px;line-height:19px;word-break:break-all;">
                <a href="${url}" style="color:#0066CC;text-decoration:underline;word-break:break-all;">${url}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:40px 28px 0;">
              <p style="margin:0;color:#86868B;font-size:12px;line-height:20px;">${meta.safetyNote}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 28px 44px;">
              <p style="margin:0;color:#86868B;font-size:11px;line-height:18px;">${FOOTER_TEXT}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ── 纯文本回退版本（图片关掉、无法收 HTML 时看这个） ─── */

function otpPlainText(meta: OtpEmailContent, code: string): string {
  return [
    `【${meta.subject}】`,
    "",
    meta.context + "。",
    "",
    `验证码：${code}（5 分钟内有效）`,
    "",
    meta.note + "。",
    "",
    FOOTER_TEXT,
  ].join("\n");
}

function resetPlainText(meta: ResetPasswordEmailContent, url: string): string {
  return [
    `【${meta.subject}】`,
    "",
    meta.fallbackIntro,
    "",
    url,
    "",
    `${meta.safetyNote}。`,
    "",
    FOOTER_TEXT,
  ].join("\n");
}

/* ── 对外 API ─────────────────────────────────────────── */

export function renderOtpEmail(
  meta: OtpEmailContent,
  opts: { code: string },
): EmailRenderResult {
  const code = String(opts.code).padStart(6, "0");
  return {
    subject: meta.subject,
    html: renderOtpHtml(meta, code),
    text: otpPlainText(meta, code),
    attachments: MAIL_ATTACHMENTS,
  };
}

export function renderResetPasswordEmail(
  meta: ResetPasswordEmailContent,
  opts: { url: string },
): EmailRenderResult {
  return {
    subject: meta.subject,
    html: renderResetHtml(meta, opts.url),
    text: resetPlainText(meta, opts.url),
    attachments: MAIL_ATTACHMENTS,
  };
}
