import { describe, expect, it } from "vitest";
import {
  accountOtpEmail,
  type AccountOtpEmailPurpose,
} from "./account-emails";

const CASES: Array<[AccountOtpEmailPurpose, string]> = [
  ["new_email", "验证你的 SURGE 新邮箱"],
  ["old_email", "确认你的 SURGE 当前邮箱"],
  ["password_change", "你的 SURGE 修改密码验证码"],
  ["account_deletion", "你的 SURGE 删除账号验证码"],
];

describe("账号安全邮件文案", () => {
  it.each(CASES)("%s 使用对应主题并保留验证码", (purpose, subject) => {
    const email = accountOtpEmail(purpose, "123456");
    expect(email.subject).toBe(subject);
    expect(email.html).toContain("123456");
    expect(email.text).toContain("123456");
  });

  it.each(CASES)("%s 不依赖远程图片", (purpose) => {
    const email = accountOtpEmail(purpose, "123456");
    const sources = [...email.html.matchAll(/src="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(sources.every((source) => source.startsWith("cid:"))).toBe(true);
  });
});
