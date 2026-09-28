import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ change: vi.fn(), complete: vi.fn(), otp: vi.fn(), audit: vi.fn() }));
vi.mock("./change-tokens", () => ({ getChangeToken: mocks.change, completeEmailChange: mocks.complete }));
vi.mock("./otp", () => ({ verifyStoredOtp: mocks.otp }));
vi.mock("@/features/security-audit/security-log", () => ({ logSecurity: mocks.audit }));
import { finishEmailChange } from "./finish-email-change";
const input = { userId: "user", currentEmail: "old@example.test", currentSessionId: "session", token: "proof", newEmail: "new@example.test", otp: "123456" };
describe("邮箱换绑业务", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.change.mockResolvedValue({ payload: { originalEmail: input.currentEmail, userVersion: 2 } });
    mocks.otp.mockResolvedValue({ ok: true });
    mocks.complete.mockResolvedValue("ok");
  });
  it("账号变化时在消费验证码前拒绝", async () => {
    await expect(finishEmailChange({ ...input, currentEmail: "changed@example.test" })).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(mocks.otp).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("游客不能通过最终提交换绑真实邮箱", async () => {
    mocks.change.mockResolvedValue({ payload: { originalEmail: "guest@demo.surge" } });
    await expect(finishEmailChange({ ...input, currentEmail: "guest@demo.surge" })).rejects.toMatchObject({ code: "GUEST_EMAIL_DOMAIN_REQUIRED", params: { domain: "demo.surge" } });
    expect(mocks.otp).not.toHaveBeenCalled();
  });
  it.each([ ["invalid-proof", "EMAIL_CHANGE_PROOF_EXPIRED"], ["conflict", "ACCOUNT_CHANGED"] ])("事务返回 %s 时不记录成功事件", async (result, code) => {
    mocks.complete.mockResolvedValue(result);
    await expect(finishEmailChange(input)).rejects.toMatchObject({ code });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("提交绑定原邮箱、版本和当前会话，并在成功后审计", async () => {
    await finishEmailChange(input);
    expect(mocks.complete).toHaveBeenCalledWith({ userId: "user", currentSessionId: "session", token: "proof", originalEmail: "old@example.test", expectedVersion: 2, newEmail: "new@example.test" });
    expect(mocks.audit).toHaveBeenCalledWith({ userId: "user", action: "EMAIL_CHANGED" });
  });
});
