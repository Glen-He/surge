import { describe, expect, it } from "vitest";
import { AccountVerificationError, accountVerificationErrorResponse } from "./account-verification-errors";

describe("accountVerificationErrorResponse", () => {
  it("保留每日限额的错误码与重试时间", async () => {
    const response = accountVerificationErrorResponse(
      new AccountVerificationError("OTP_DAILY_LIMIT", { retryAfter: 7_200 }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "今日验证码发送次数已达上限，请明天再试",
      code: "OTP_DAILY_LIMIT",
      retryAfter: 7_200,
    });
  });

  it("保留冷却期的错误码与重试时间", async () => {
    const response = accountVerificationErrorResponse(
      new AccountVerificationError("OTP_COOLDOWN", { retryAfter: 42 }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "请 42 秒后再试",
      code: "OTP_COOLDOWN",
      retryAfter: 42,
    });
  });
});

// 不执行，只由 TypeScript 检查错误码与参数的绑定关系。
function verifyErrorTypes() {
  // @ts-expect-error 重试限流必须提供等待秒数。
  new AccountVerificationError("PASSWORD_VERIFY_RATE_LIMIT");
  // @ts-expect-error 验证码错误不接受错误拼写的参数。
  new AccountVerificationError("OTP_INCORRECT", { attempts: 2 });
  // @ts-expect-error 无参数的错误码不能携带多余参数。
  new AccountVerificationError("OTP_EXPIRED", { remaining: 0 });
}
void verifyErrorTypes;
