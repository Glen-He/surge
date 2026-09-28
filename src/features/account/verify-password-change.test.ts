import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ password: vi.fn(), allowance: vi.fn(), failure: vi.fn(), clear: vi.fn(), audit: vi.fn(), token: vi.fn(), otp: vi.fn() }));
vi.mock("@/features/auth/auth", () => ({ auth: { api: { verifyPassword: mocks.password } } }));
vi.mock("@/features/auth/auth-attempts", () => ({ checkReauthenticationAllowed: mocks.allowance, recordReauthenticationFailure: mocks.failure, clearReauthenticationFailures: mocks.clear }));
vi.mock("@/features/security-audit/security-log", () => ({ logSecurity: mocks.audit }));
vi.mock("./change-tokens", () => ({ createChangeToken: mocks.token }));
vi.mock("./otp", () => ({ verifyStoredOtp: mocks.otp }));
import { verifyPasswordChange } from "./verify-password-change";
import { AccountVerificationError } from "./account-verification-errors";
const input = { userId: "user", email: "user@example.test", headers: new Headers(), method: "password" as const, password: "correct-password", otp: "123456" };
describe("改密身份验证", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.allowance.mockResolvedValue({ allowed: true });
    mocks.token.mockResolvedValue("change-token");
  });
  it("限流与错误密码均不能签发证明，错误密码计入失败次数", async () => {
    mocks.allowance.mockResolvedValueOnce({ allowed: false, retryAfter: 42 });
    await expect(verifyPasswordChange(input)).rejects.toMatchObject({ code: "PASSWORD_VERIFY_RATE_LIMIT", params: { retryAfter: 42 } });
    expect(mocks.password).not.toHaveBeenCalled();
    mocks.password.mockRejectedValueOnce(new Error("invalid password"));
    await expect(verifyPasswordChange(input)).rejects.toMatchObject({ code: "PASSWORD_INCORRECT" });
    expect(mocks.failure).toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it("成功后清除失败计数、记录审计并签发一次性改密证明", async () => {
    await expect(verifyPasswordChange(input)).resolves.toBe("change-token");
    expect(mocks.clear).toHaveBeenCalledWith("user");
    expect(mocks.audit).toHaveBeenCalledWith({ userId: "user", action: "PASSWORD_VERIFY_BY_PASSWORD" });
    expect(mocks.token).toHaveBeenCalledWith({ userId: "user", type: "password_change" });
  });
  it("验证码错误保持结构化，成功验证码使用独立审计事件", async () => {
    mocks.otp.mockResolvedValueOnce({ ok: false, error: new AccountVerificationError("OTP_EXPIRED") });
    await expect(verifyPasswordChange({ ...input, method: "otp" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
    expect(mocks.token).not.toHaveBeenCalled();
    mocks.otp.mockResolvedValueOnce({ ok: true });
    await expect(verifyPasswordChange({ ...input, method: "otp" })).resolves.toBe("change-token");
    expect(mocks.password).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith({ userId: "user", action: "PASSWORD_VERIFY_BY_OTP" });
  });
});
