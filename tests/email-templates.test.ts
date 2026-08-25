import { describe, expect, it } from "vitest";
import {
  renderOtpEmail,
  renderResetPasswordEmail,
  type OtpTemplateId,
} from "@/lib/email-templates";

const OTP_IDS: OtpTemplateId[] = [
  "login",
  "new_email",
  "old_email",
  "password_change",
  "account_deletion",
];

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

  it("HTML 不含外部 css/js 引用，图片仅走公开基础域", () => {
    const r = renderOtpEmail("login", { code: "123456" });
    expect(r.html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(r.html).not.toMatch(/<script/i);
    // 无 MAIL_PUBLIC_URL 时兜底 localhost：所有 img src 要么 data: 要么以该域开头
    const srcs = [...r.html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) {
      expect(s.startsWith("data:") || s.startsWith("http://localhost:3000/")).toBe(true);
    }
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
});
