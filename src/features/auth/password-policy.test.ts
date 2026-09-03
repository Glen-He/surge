import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  PASSWORD_RULE_TEXT,
  passwordPolicyError,
} from "@/features/auth/password-policy";

describe("passwordPolicyError 密码策略", () => {
  it("长度不足被拒", () => {
    expect(passwordPolicyError("Ab1")).toBe(`密码至少 ${PASSWORD_MIN} 位`);
    expect(passwordPolicyError("Ab1defg")).toBe(`密码至少 ${PASSWORD_MIN} 位`); // 7 位
  });

  it("缺少大写字母被拒", () => {
    expect(passwordPolicyError("abcdefg1")).toBe("密码需包含大写字母");
  });

  it("缺少小写字母被拒", () => {
    expect(passwordPolicyError("ABCDEFG1")).toBe("密码需包含小写字母");
  });

  it("缺少数字被拒", () => {
    expect(passwordPolicyError("Abcdefgh")).toBe("密码需包含数字");
  });

  it("满足规则（大写+小写+数字、>=8 位）通过", () => {
    expect(passwordPolicyError("Abcdefg1")).toBeNull();
    expect(passwordPolicyError("Passw0rd")).toBeNull();
    expect(passwordPolicyError("aB3")).not.toBeNull(); // 3 位仍太短
  });

  it("恰好 8 位含三类字符通过", () => {
    expect(passwordPolicyError("aB3cdefg")).toBeNull();
  });

  it("超长被拒", () => {
    expect(passwordPolicyError("aB3".repeat(PASSWORD_MAX))).toBe("密码过长");
  });

  it("空密码按长度不足处理", () => {
    expect(passwordPolicyError("")).toBe(`密码至少 ${PASSWORD_MIN} 位`);
  });

  it("提示文案与规则一致", () => {
    expect(PASSWORD_RULE_TEXT).toContain(String(PASSWORD_MIN));
    expect(PASSWORD_RULE_TEXT).toContain("大写");
    expect(PASSWORD_RULE_TEXT).toContain("小写");
    expect(PASSWORD_RULE_TEXT).toContain("数字");
  });
});
