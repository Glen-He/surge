import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkUnlockRate: vi.fn(),
  clearUnlockRate: vi.fn(),
  recordUnlockFailure: vi.fn(),
  verifySharePassword: vi.fn(),
}));

vi.mock("./report-share", () => mocks);

import { verifyShareUnlockAttempt } from "./unlock-shared-content";

const base = {
  token: "tok",
  ip: "203.0.113.9",
  password: "A1B2",
  passwordHash: "hash",
  rateKey: "tok",
};

describe("分享提取码校验", () => {
  beforeEach(() => vi.clearAllMocks());

  it("无密码的链接直接通过，不消耗限流额度", async () => {
    await expect(
      verifyShareUnlockAttempt({ ...base, passwordHash: null }),
    ).resolves.toEqual({ kind: "no-password" });
    expect(mocks.checkUnlockRate).not.toHaveBeenCalled();
  });

  it("限流拒绝时不校验密码", async () => {
    mocks.checkUnlockRate.mockResolvedValue({ ok: false, retryAfter: 42 });
    await expect(verifyShareUnlockAttempt(base)).resolves.toEqual({
      kind: "unlock-rate",
      retryAfter: 42,
    });
    expect(mocks.verifySharePassword).not.toHaveBeenCalled();
  });

  it("错误提取码记录失败并返回错误", async () => {
    mocks.checkUnlockRate.mockResolvedValue({ ok: true });
    mocks.verifySharePassword.mockResolvedValue(false);
    mocks.recordUnlockFailure.mockResolvedValue({ ok: true });
    await expect(verifyShareUnlockAttempt(base)).resolves.toEqual({
      kind: "wrong-passcode",
    });
    expect(mocks.recordUnlockFailure).toHaveBeenCalledWith("tok");
  });

  it("连续失败触发限流时返回 unlock-rate", async () => {
    mocks.checkUnlockRate.mockResolvedValue({ ok: true });
    mocks.verifySharePassword.mockResolvedValue(false);
    mocks.recordUnlockFailure.mockResolvedValue({ ok: false, retryAfter: 7 });
    await expect(verifyShareUnlockAttempt(base)).resolves.toEqual({
      kind: "unlock-rate",
      retryAfter: 7,
    });
  });

  it("正确提取码清空失败记录", async () => {
    mocks.checkUnlockRate.mockResolvedValue({ ok: true });
    mocks.verifySharePassword.mockResolvedValue(true);
    await expect(verifyShareUnlockAttempt(base)).resolves.toEqual({ kind: "ok" });
    expect(mocks.clearUnlockRate).toHaveBeenCalledWith("tok", base.ip);
  });
});
