import { describe, expect, it } from "vitest";
import {
  RegistrationError,
  registrationErrorResponse,
} from "./registration-errors";

describe("registrationErrorResponse", () => {
  it("注册验证码频控沿用验证码专属文案", async () => {
    const response = registrationErrorResponse(
      new RegistrationError("REGISTRATION_OTP_RATE_LIMIT"),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "验证码发送过于频繁，请稍后再试",
    });
  });

  it("邀请码错误保留机器可读 code", async () => {
    const response = registrationErrorResponse(
      new RegistrationError("INVITE_INVALID"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "邀请码无效或已撤销",
      code: "INVITE_INVALID",
    });
  });
});
