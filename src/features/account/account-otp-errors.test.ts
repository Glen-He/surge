import { describe, expect, it } from "vitest";
import { AccountOtpError, accountOtpErrorResponse } from "./account-otp-errors";

describe("accountOtpErrorResponse", () => {
  it("保留每日限额的错误码与重试时间", async () => {
    const response = accountOtpErrorResponse(
      new AccountOtpError("OTP_DAILY_LIMIT", { retryAfter: 7_200 }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "今日验证码发送次数已达上限，请明天再试",
      code: "OTP_DAILY_LIMIT",
      retryAfter: 7_200,
    });
  });

  it("保留冷却期的错误码与重试时间", async () => {
    const response = accountOtpErrorResponse(
      new AccountOtpError("OTP_COOLDOWN", { retryAfter: 42 }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "请 42 秒后再试",
      code: "OTP_COOLDOWN",
      retryAfter: 42,
    });
  });
});
