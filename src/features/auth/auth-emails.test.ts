import { describe, expect, it } from "vitest";
import { loginOtpEmail, resetPasswordEmail } from "./auth-emails";

describe("认证邮件文案", () => {
  it("登录验证码邮件包含 6 位验证码和安全提示", () => {
    const email = loginOtpEmail("824619");
    expect(email.subject).toBe("你的 SURGE 登录验证码");
    expect(email.html).toContain("824619");
    expect(email.text).toContain("824619");
    expect(email.text).toContain("非本人操作可忽略");
  });

  it("重置密码邮件在 HTML 与纯文本中保留同一链接", () => {
    const url = "https://example.test/reset?token=abc";
    const email = resetPasswordEmail(url);
    expect(email.subject).toBe("重置你的 SURGE 密码");
    expect(email.html).toContain(url);
    expect(email.text).toContain(url);
  });
});
