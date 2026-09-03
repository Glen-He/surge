import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import {
  renderOtpEmail,
  renderResetPasswordEmail,
  type OtpTemplateId,
} from "@/infrastructure/email/templates";

const OTP_IDS: OtpTemplateId[] = [
  "login",
  "new_email",
  "old_email",
  "password_change",
  "account_deletion",
];

/** 提取 HTML 中全部 cid: 引用（src 属性） */
function htmlCids(html: string): string[] {
  return [...html.matchAll(/src="cid:([^"]+)"/g)].map((m) => m[1]);
}

/** HTML 与附件的 CID 必须严格一一对应（双向都无多余） */
function expectCidsMatch(html: string, attachments: readonly { cid: string }[]) {
  const cids = htmlCids(html);
  const attachmentCids = attachments.map((a) => a.cid);
  expect(cids.sort()).toEqual(attachmentCids.sort());
}

describe("renderOtpEmail", () => {
  it.each(OTP_IDS)("场景 %s：主题/HTML/纯文本都含 6 位验证码", (id) => {
    const r = renderOtpEmail(id, { code: "824619" });
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.html).toContain("824619");
    expect(r.text).toContain("824619");
  });

  it("不足 6 位补前导零", () => {
    const r = renderOtpEmail("login", { code: "42" });
    expect(r.html).toContain("000042");
    expect(r.text).toContain("000042");
  });

  it.each(OTP_IDS)("场景 %s：纯文本包含链接/忽略提示等回退内容", (id) => {
    const r = renderOtpEmail(id, { code: "123456" });
    expect(r.text).toContain("SURGE");
  });

  it.each(OTP_IDS)("场景 %s：HTML cid 引用与附件一一对应", (id) => {
    const r = renderOtpEmail(id, { code: "123456" });
    expectCidsMatch(r.html, r.attachments);
    expect(htmlCids(r.html)).toContain("mail-icon-email@surge");
    expect(htmlCids(r.html)).toContain("mail-icon-clock@surge");
  });

  it.each(OTP_IDS)("场景 %s：附件为 inline PNG（filename/cid/content 齐全）", (id) => {
    const r = renderOtpEmail(id, { code: "123456" });
    expect(r.attachments).toHaveLength(2);
    for (const a of r.attachments) {
      expect(a.contentType).toBe("image/png");
      expect(a.contentDisposition).toBe("inline");
      expect(a.filename).toMatch(/\.png$/);
      expect(Buffer.isBuffer(a.content)).toBe(true);
      expect(a.content.length).toBeGreaterThan(100);
    }
  });

  it("HTML 不含外部 css/js 引用，图片一律 CID（不回源任何远程 URL）", () => {
    const r = renderOtpEmail("login", { code: "123456" });
    expect(r.html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(r.html).not.toMatch(/<script/i);
    const srcs = [...r.html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) {
      expect(s.startsWith("cid:")).toBe(true);
    }
    // 旧远程引用彻底移除
    expect(r.html).not.toContain("/mail/icon-email.png");
    expect(r.html).not.toContain("/mail/clock-email.png");
    expect(r.html).not.toMatch(/https?:\/\/[^"']+/);
  });

  it.each(OTP_IDS)("场景 %s：纯文本不受 CID 改造影响", (id) => {
    const r = renderOtpEmail(id, { code: "123456" });
    expect(r.text).not.toContain("cid:");
    expect(r.text).not.toContain("http");
  });
});

describe("renderResetPasswordEmail", () => {
  const url = "https://example.com/reset?token=abc123";

  it("HTML 与纯文本均包含重置链接", () => {
    const r = renderResetPasswordEmail({ url });
    expect(r.html).toContain(url);
    expect(r.text).toContain(url);
  });

  it("按钮之外有纯文本链接回退（邮件客户端禁用按钮时可用）", () => {
    const r = renderResetPasswordEmail({ url });
    // HTML 中链接至少出现两次：按钮 href + 文本回退
    expect(r.html.split(url).length).toBeGreaterThanOrEqual(3);
  });

  it("不含外部脚本/样式引用", () => {
    const r = renderResetPasswordEmail({ url });
    expect(r.html).not.toMatch(/<script/i);
    expect(r.html).not.toMatch(/<link[^>]+stylesheet/i);
  });

  it("HTML cid 引用与附件一一对应", () => {
    const r = renderResetPasswordEmail({ url });
    expectCidsMatch(r.html, r.attachments);
    expect(htmlCids(r.html)).toContain("mail-icon-email@surge");
    expect(htmlCids(r.html)).toContain("mail-icon-clock@surge");
    // 重置邮件的图片同样不再回源（重置链接本身除外）
    const srcs = [...r.html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    for (const s of srcs) {
      expect(s.startsWith("cid:")).toBe(true);
    }
  });
});

describe("SMTP MIME 结构（nodemailer streamTransport 生成真实报文）", () => {
  // streamTransport + buffer：不连接 SMTP，仅让 nodemailer 在内存中
  // 生成最终 MIME，验证 multipart/related 与 CID part 的真实形态
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });

  async function buildRawMime(r: {
    subject: string;
    html: string;
    text: string;
    attachments: readonly object[];
  }): Promise<string> {
    const info = await transport.sendMail({
      from: "noreply@surge.test",
      to: "user@example.test",
      subject: r.subject,
      text: r.text,
      html: r.html,
      attachments: [...r.attachments],
    });
    return (info.message as Buffer).toString("utf8");
  }

  it("OTP 邮件：multipart/related + PNG CID part（inline）", async () => {
    const raw = await buildRawMime(renderOtpEmail("login", { code: "123456" }));
    expect(raw).toContain("multipart/related");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain('Content-Type: image/png');
    expect(raw).toContain('Content-ID: <mail-icon-email@surge>');
    expect(raw).toContain('Content-ID: <mail-icon-clock@surge>');
    expect(raw).toContain('Content-Disposition: inline');
  });

  it("重置密码邮件：multipart/related + PNG CID part（inline）", async () => {
    const raw = await buildRawMime(
      renderResetPasswordEmail({ url: "https://example.test/reset?token=abc" }),
    );
    expect(raw).toContain("multipart/related");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain('Content-Type: image/png');
    expect(raw).toContain('Content-ID: <mail-icon-email@surge>');
    expect(raw).toContain('Content-ID: <mail-icon-clock@surge>');
    expect(raw).toContain('Content-Disposition: inline');
  });
});
