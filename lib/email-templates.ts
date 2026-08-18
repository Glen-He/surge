/* 邮件 HTML 渲染：视觉对齐 tmp/gen-email-templates.cjs 产出的设计稿
 *
 * 使用方式：
 *   import { renderOtpEmail, renderResetPasswordEmail } from "@/lib/email-templates";
 *   const { subject, html, text } = renderOtpEmail("login", { code: "824619" });
 *   await transporter.sendMail({ to, subject, text, html });
 *
 * 图片 URL（邮件客户端必须走绝对地址）：
 *   优先读 process.env.MAIL_PUBLIC_URL，其次回退到常见部署变量。
 *   没有配置时用 http://localhost:3000（只适合本地调试邮件客户端，
 *   真正发信必须配置 MAIL_PUBLIC_URL，否则对方邮件客户端无法加载图）。
 */

export type OtpTemplateId =
  | "login"
  | "new_email"
  | "old_email"
  | "password_change"
  | "account_deletion";

export type EmailRenderResult = {
  subject: string;
  html: string;
  text: string;
};

/* ── 配置 ──────────────────────────────────────────────── */

function buildPublicBase(): string {
  const raw =
    process.env.MAIL_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  let base = raw.trim().replace(/\/+$/, "");
  if (base && !/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
  return base;
}

const PUBLIC_BASE = buildPublicBase();
const LOGO_SRC = `${PUBLIC_BASE}/mail/icon-email.png`;
const CLOCK_SRC = `${PUBLIC_BASE}/mail/clock-email.png`;

/* ── 共享骨架（样式 + 容器 + 头尾） ─────────────────────── */

const HEAD_STYLE = `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background: #F4F5F7;
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
    @media screen and (max-width: 760px) {
      .page-padding { padding-left: 14px !important; padding-right: 14px !important; padding-top: 28px !important; padding-bottom: 40px !important; }
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-card { border-radius: 22px !important; }
      .content-padding { padding-left: 28px !important; padding-right: 28px !important; }
      .logo-area { padding-top: 34px !important; }
      .brand-wordmark { font-size: 14px !important; letter-spacing: 3px !important; margin-top: 14px !important; }
      .main-title { font-size: 28px !important; line-height: 38px !important; }
      .intro-text { font-size: 15px !important; line-height: 26px !important; }
      .code-box { padding-top: 24px !important; padding-bottom: 24px !important; }
      .code-text { font-size: 38px !important; line-height: 48px !important; letter-spacing: 8px !important; margin-right: -8px !important; }
      .security-copy { font-size: 13px !important; line-height: 22px !important; }
    }
    @media screen and (max-width: 420px) {
      .content-padding { padding-left: 22px !important; padding-right: 22px !important; }
      .code-text { font-size: 32px !important; letter-spacing: 6px !important; margin-right: -6px !important; }
      .security-icon-cell { width: 38px !important; }
    }
`;

const CLOCK_ICON = `<img src="${CLOCK_SRC}" width="20" height="20" alt="" style="display:block;border:0;margin:2px;">`;

const INFO_ICON = `<span style="display:inline-block;width:26px;height:26px;border:2px solid #969BA5;border-radius:50%;color:#969BA5;font-family:Arial,sans-serif;font-size:17px;line-height:23px;text-align:center;font-weight:700;box-sizing:border-box;">i</span>`;

const SAFE_NOTE =
  "为保护你的账号安全，请勿向任何人透露验证码。<br>如果这不是你本人发起的操作，可以安全忽略此邮件。";

/* 验证码场景元数据（来自 gen-email-templates.cjs templates[]） */
type OtpMeta = {
  subject: string;
  preheader: string;
  title: string; // <title> 里显示的页面标题，不一定等于 subject
  headline: string;
  body: string;
  instruction: string;
  note: string;
};

const OTP_META: Record<OtpTemplateId, OtpMeta> = {
  login: {
    subject: "你的 SURGE 登录验证码",
    preheader: "你的 SURGE 登录验证码为 {code}，5 分钟内有效。",
    title: "登录验证码",
    headline: "登录验证码",
    body: "你正在登录 SURGE 工作汇报系统，<br>请使用以下验证码完成身份验证。",
    instruction: "请返回 SURGE 页面并输入以上验证码",
    note: SAFE_NOTE,
  },
  new_email: {
    subject: "验证你的 SURGE 新邮箱",
    preheader: "你的 SURGE 新邮箱验证码为 {code}，5 分钟内有效。",
    title: "新邮箱验证码",
    headline: "验证你的新邮箱",
    body: "你正在将账号邮箱修改为新地址，<br>请使用以下验证码完成新邮箱验证。",
    instruction: "请返回 SURGE 页面并输入以上验证码",
    note: SAFE_NOTE,
  },
  old_email: {
    subject: "确认你的 SURGE 当前邮箱",
    preheader: "你的 SURGE 当前邮箱验证码为 {code}，5 分钟内有效。",
    title: "旧邮箱验证码",
    headline: "确认你的当前邮箱",
    body: "你正在修改账号邮箱，为保障账号安全，<br>请在下方输入验证码确认当前邮箱归属。",
    instruction: "请返回 SURGE 页面并输入以上验证码",
    note: SAFE_NOTE,
  },
  password_change: {
    subject: "你的 SURGE 修改密码验证码",
    preheader: "你的 SURGE 修改密码验证码为 {code}，5 分钟内有效。",
    title: "修改密码验证码",
    headline: "修改登录密码",
    body: "你正在修改登录密码，<br>请使用以下验证码完成验证。",
    instruction: "请返回 SURGE 页面并输入以上验证码",
    note: SAFE_NOTE,
  },
  account_deletion: {
    subject: "你的 SURGE 删除账号验证码",
    preheader: "你的 SURGE 删除账号验证码为 {code}，5 分钟内有效。",
    title: "删除账号验证码",
    headline: "确认删除账号",
    body: "你正在申请删除账号，此操作不可恢复，<br>请在下方输入验证码完成确认。",
    instruction: "请返回 SURGE 页面并输入以上验证码",
    note:
      "删除后账号及全部数据将被永久清除，无法恢复；<br>15 天冷却期内可随时取消删除。",
  },
};

/* 通用渲染：验证码型（5 种 id） */
function renderOtpHtml(meta: OtpMeta, code: string): string {
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
<body style="margin:0;padding:0;width:100%;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F4F5F7;">
    <tr>
      <td align="center" class="page-padding" style="padding:34px 20px 44px;">
        <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" class="email-container email-card" style="width:100%;max-width:720px;background:#FFFFFF;border:1px solid #ECEEF1;border-radius:28px;box-shadow:0 16px 46px rgba(25,32,45,0.055);">
          <tr>
            <td align="center" class="content-padding logo-area" style="padding:48px 60px 0;">
              <img src="${LOGO_SRC}" width="68" height="68" alt="SURGE" style="display:block;margin:0 auto;border:0;">
              <div class="brand-wordmark" style="margin-top:14px;color:#24262B;font-size:15px;line-height:22px;font-weight:700;letter-spacing:3px;">SURGE</div>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:32px 60px 0;">
              <h1 class="main-title" style="margin:0;color:#1D1F23;font-size:32px;line-height:42px;font-weight:700;letter-spacing:-0.5px;">${meta.headline}</h1>
              <p class="intro-text" style="margin:14px auto 0;max-width:520px;color:#777C86;font-size:16px;line-height:28px;font-weight:400;">${meta.body}</p>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:30px 60px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#FFF4F2;border:1px solid #FBE4E0;border-radius:22px;">
                <tr>
                  <td align="center" class="code-box" style="padding:28px 24px;">
                    <div class="code-text" style="margin:0 -13px 0 0;color:#EB4436;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:48px;line-height:58px;font-weight:700;letter-spacing:13px;white-space:nowrap;">${code}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:18px 60px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td valign="middle" style="padding-right:8px;color:#EB4436;font-size:0;line-height:0;">${CLOCK_ICON}</td>
                  <td valign="middle" style="color:#34373D;font-size:14px;line-height:22px;font-weight:600;">5 分钟内有效</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:28px 60px 0;">
              <p style="margin:0;color:#92969E;font-size:13px;line-height:20px;">${meta.instruction}</p>
            </td>
          </tr>
          <tr>
            <td class="content-padding" style="padding:28px 60px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F7F8FA;border:1px solid #F0F1F3;border-radius:18px;">
                <tr>
                  <td valign="middle" align="center" width="64" class="security-icon-cell" style="width:64px;padding:22px 0 22px 18px;">${INFO_ICON}</td>
                  <td valign="middle" width="1" style="width:1px;padding:20px 0;">
                    <div style="width:1px;height:48px;background:#D9DCE1;font-size:0;line-height:0;">&nbsp;</div>
                  </td>
                  <td valign="middle" class="security-copy" style="padding:20px 24px 20px 24px;color:#555B65;font-size:14px;line-height:24px;">${meta.note}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:40px 60px 44px;">
              <p style="margin:0;color:#A3A7AF;font-size:12px;line-height:21px;">此邮件由 SURGE 工作汇报系统自动发送，请勿直接回复。</p>
              <p style="margin:5px 0 0;color:#B7BAC0;font-size:12px;line-height:21px;">© 2026 SURGE · 让工作记录更清晰</p>
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
function renderResetHtml(url: string): string {
  const preheader = "你请求了重置 SURGE 密码，链接 1 小时内有效。";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>SURGE 工作汇报系统 · 重置密码</title>
  <style>${HEAD_STYLE}  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F4F5F7;">
    <tr>
      <td align="center" class="page-padding" style="padding:34px 20px 44px;">
        <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" class="email-container email-card" style="width:100%;max-width:720px;background:#FFFFFF;border:1px solid #ECEEF1;border-radius:28px;box-shadow:0 16px 46px rgba(25,32,45,0.055);">
          <tr>
            <td align="center" class="content-padding logo-area" style="padding:48px 60px 0;">
              <img src="${LOGO_SRC}" width="68" height="68" alt="SURGE" style="display:block;margin:0 auto;border:0;">
              <div class="brand-wordmark" style="margin-top:14px;color:#24262B;font-size:15px;line-height:22px;font-weight:700;letter-spacing:3px;">SURGE</div>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:32px 60px 0;">
              <h1 class="main-title" style="margin:0;color:#1D1F23;font-size:32px;line-height:42px;font-weight:700;letter-spacing:-0.5px;">重置你的密码</h1>
              <p class="intro-text" style="margin:14px auto 0;max-width:520px;color:#777C86;font-size:16px;line-height:28px;font-weight:400;">你请求了重置密码，<br>请点击下方按钮设置新密码。</p>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:30px 60px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td bgcolor="#EB4436" style="border-radius:999px;padding:14px 44px;">
                    <a href="${url}" style="color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;">设置新密码</a>
                  </td>
                </tr>
              </table>
              <div style="margin-top:12px;color:#92969E;font-size:12px;line-height:20px;">链接 1 小时内有效</div>
              <div style="margin-top:10px;font-size:12px;line-height:19px;word-break:break-all;">
                <a href="${url}" style="color:#92969E;text-decoration:underline;word-break:break-all;">${url}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:28px 60px 0;">
              <p style="margin:0;color:#92969E;font-size:13px;line-height:20px;">按钮无法点击时，可复制上方链接到浏览器打开</p>
            </td>
          </tr>
          <tr>
            <td class="content-padding" style="padding:28px 60px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F7F8FA;border:1px solid #F0F1F3;border-radius:18px;">
                <tr>
                  <td valign="middle" align="center" width="64" class="security-icon-cell" style="width:64px;padding:22px 0 22px 18px;">${INFO_ICON}</td>
                  <td valign="middle" width="1" style="width:1px;padding:20px 0;">
                    <div style="width:1px;height:48px;background:#D9DCE1;font-size:0;line-height:0;">&nbsp;</div>
                  </td>
                  <td valign="middle" class="security-copy" style="padding:20px 24px 20px 24px;color:#555B65;font-size:14px;line-height:24px;">如果这不是你本人发起的操作，请忽略此邮件，<br>你的账号是安全的。</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" class="content-padding" style="padding:40px 60px 44px;">
              <p style="margin:0;color:#A3A7AF;font-size:12px;line-height:21px;">此邮件由 SURGE 工作汇报系统自动发送，请勿直接回复。</p>
              <p style="margin:5px 0 0;color:#B7BAC0;font-size:12px;line-height:21px;">© 2026 SURGE · 让工作记录更清晰</p>
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

function otpPlainText(meta: OtpMeta, code: string): string {
  const headline = stripBr(meta.headline);
  const body = stripBr(meta.body);
  const instruction = stripBr(meta.instruction);
  const note = stripBr(meta.note);
  return [
    `【${meta.subject}】`,
    "",
    headline,
    body,
    "",
    `验证码：${code}  （5 分钟内有效，请勿泄露给他人）`,
    "",
    instruction,
    "",
    "———",
    note,
    "",
    "此邮件由 SURGE 工作汇报系统自动发送，请勿直接回复。",
    "© 2026 SURGE · 让工作记录更清晰",
  ].join("\n");
}

function resetPlainText(url: string): string {
  return [
    "【重置你的 SURGE 密码】",
    "",
    "你请求了重置密码，请点击下方链接（或复制到浏览器打开）设置新密码：",
    "",
    url,
    "",
    "链接 1 小时内有效。",
    "如果这不是你本人发起的操作，请忽略此邮件，你的账号是安全的。",
    "",
    "此邮件由 SURGE 工作汇报系统自动发送，请勿直接回复。",
    "© 2026 SURGE · 让工作记录更清晰",
  ].join("\n");
}

function stripBr(s: string): string {
  return s.replaceAll("<br>", " ").replaceAll(/<[^>]+>/g, "").trim();
}

/* ── 对外 API ─────────────────────────────────────────── */

export function renderOtpEmail(
  id: OtpTemplateId,
  opts: { code: string },
): EmailRenderResult {
  const meta = OTP_META[id];
  const code = String(opts.code).padStart(6, "0");
  return {
    subject: meta.subject,
    html: renderOtpHtml(meta, code),
    text: otpPlainText(meta, code),
  };
}

export function renderResetPasswordEmail(opts: {
  url: string;
}): EmailRenderResult {
  return {
    subject: "重置你的 SURGE 密码",
    html: renderResetHtml(opts.url),
    text: resetPlainText(opts.url),
  };
}
