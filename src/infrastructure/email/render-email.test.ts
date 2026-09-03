import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import {
  renderOtpEmail,
  renderResetPasswordEmail,
  type OtpEmailContent,
  type ResetPasswordEmailContent,
} from "@/infrastructure/email/render-email";

const OTP_CONTENT: OtpEmailContent = {
  subject: "测试验证码",
  preheader: "验证码为 {code}",
  title: "测试验证码",
  headline: "测试验证码",
  context: "你正在执行测试操作",
  note: "非本人操作可忽略",
};

const RESET_CONTENT: ResetPasswordEmailContent = {
  subject: "测试重置密码",
  preheader: "测试重置链接",
  title: "重置密码",
  headline: "重置你的密码",
  context: "请设置新密码",
  buttonLabel: "设置新密码",
  expiryLabel: "链接 1 小时内有效",
  fallbackIntro: "请使用以下链接设置新密码：",
  safetyNote: "非本人操作请忽略",
};

function htmlCids(html: string): string[] {
  return [...html.matchAll(/src="cid:([^"]+)"/g)].map((match) => match[1]);
}

function expectCidsMatch(
  html: string,
  attachments: readonly { cid: string }[],
) {
  expect(htmlCids(html).sort()).toEqual(
    attachments.map((attachment) => attachment.cid).sort(),
  );
}

describe("renderOtpEmail", () => {
  it("在主题、HTML 与纯文本中保留业务层传入的验证码内容", () => {
    const result = renderOtpEmail(OTP_CONTENT, { code: "824619" });
    expect(result.subject).toBe(OTP_CONTENT.subject);
    expect(result.html).toContain("824619");
    expect(result.text).toContain("824619");
    expect(result.html).toContain(OTP_CONTENT.context);
  });

  it("不足 6 位时补前导零", () => {
    const result = renderOtpEmail(OTP_CONTENT, { code: "42" });
    expect(result.html).toContain("000042");
    expect(result.text).toContain("000042");
  });

  it("CID 引用与 inline PNG 附件严格对应", () => {
    const result = renderOtpEmail(OTP_CONTENT, { code: "123456" });
    expectCidsMatch(result.html, result.attachments);
    expect(result.attachments).toHaveLength(2);
    for (const attachment of result.attachments) {
      expect(attachment.contentType).toBe("image/png");
      expect(attachment.contentDisposition).toBe("inline");
      expect(Buffer.isBuffer(attachment.content)).toBe(true);
      expect(attachment.content.length).toBeGreaterThan(100);
    }
  });

  it("不引入外部 CSS、脚本或远程图片", () => {
    const result = renderOtpEmail(OTP_CONTENT, { code: "123456" });
    expect(result.html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(result.html).not.toMatch(/<script/i);
    const sources = [...result.html.matchAll(/src="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.startsWith("cid:"))).toBe(true);
    expect(result.text).not.toContain("cid:");
  });
});

describe("renderResetPasswordEmail", () => {
  const url = "https://example.com/reset?token=abc123";

  it("HTML 与纯文本均包含重置链接和业务层文案", () => {
    const result = renderResetPasswordEmail(RESET_CONTENT, { url });
    expect(result.subject).toBe(RESET_CONTENT.subject);
    expect(result.html).toContain(url);
    expect(result.text).toContain(url);
    expect(result.html).toContain(RESET_CONTENT.context);
    expect(result.html.split(url).length).toBeGreaterThanOrEqual(3);
  });

  it("CID 引用与附件严格对应", () => {
    const result = renderResetPasswordEmail(RESET_CONTENT, { url });
    expectCidsMatch(result.html, result.attachments);
    expect(result.html).not.toMatch(/<script/i);
    expect(result.html).not.toMatch(/<link[^>]+stylesheet/i);
  });
});

describe("SMTP MIME 结构", () => {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });

  async function buildRawMime(result: {
    subject: string;
    html: string;
    text: string;
    attachments: readonly object[];
  }): Promise<string> {
    const info = await transport.sendMail({
      from: "noreply@surge.test",
      to: "user@example.test",
      subject: result.subject,
      text: result.text,
      html: result.html,
      attachments: [...result.attachments],
    });
    return (info.message as Buffer).toString("utf8");
  }

  it.each([
    ["OTP", renderOtpEmail(OTP_CONTENT, { code: "123456" })],
    [
      "重置密码",
      renderResetPasswordEmail(RESET_CONTENT, {
        url: "https://example.test/reset?token=abc",
      }),
    ],
  ])("%s 邮件生成 multipart/related 与 inline PNG", async (_name, result) => {
    const raw = await buildRawMime(result);
    expect(raw).toContain("multipart/related");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Content-Type: image/png");
    expect(raw).toContain("Content-ID: <mail-icon-email@surge>");
    expect(raw).toContain("Content-ID: <mail-icon-clock@surge>");
    expect(raw).toContain("Content-Disposition: inline");
  });
});
