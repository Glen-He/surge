import { describe, expect, it } from "vitest";
import {
  isOtpCode,
  normalizeOtpCode,
  OTP_CODE_LENGTH,
} from "@/features/auth/otp-code";

describe("验证码格式", () => {
  it("统一限制为六位数字", () => {
    expect(OTP_CODE_LENGTH).toBe(6);
    expect(normalizeOtpCode("12a34 5678")).toBe("123456");
    expect(normalizeOtpCode("１２３４５６")).toBe("");
  });

  it("只接受完整六位数字", () => {
    expect(isOtpCode("012345")).toBe(true);
    expect(isOtpCode("12345")).toBe(false);
    expect(isOtpCode("1234567")).toBe(false);
    expect(isOtpCode("12345A")).toBe(false);
    expect(isOtpCode(123456)).toBe(false);
  });
});
