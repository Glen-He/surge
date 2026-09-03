import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/infrastructure/database/client", () => ({ db: { query: mocks.query } }));

describe("注册策略", () => {
  beforeEach(() => mocks.query.mockReset());

  it("从数据库读取实时开关和邀请码策略", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ registration_enabled: true, invite_required: true }],
    });
    const { getRegistrationPolicy } = await import("@/features/auth/registration-policy");
    await expect(getRegistrationPolicy()).resolves.toEqual({
      enabled: true,
      inviteRequired: true,
    });
  });

  it("更新时关闭注册会同时关闭邀请码强制策略", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ registration_enabled: false, invite_required: false }],
    });
    const { updateRegistrationPolicy } = await import("@/features/auth/registration-policy");
    await expect(
      updateRegistrationPolicy({
        enabled: false,
        inviteRequired: true,
        updatedBy: "user-1",
      }),
    ).resolves.toEqual({ enabled: false, inviteRequired: false });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([false, false, "user-1"]);
  });

  it("内部注册证明绑定邮箱并拒绝篡改", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "registration-test-secret-at-least-32-chars");
    const {
      registrationInternalProof,
      verifyRegistrationInternalProof,
    } = await import("@/features/auth/registration-policy");
    const proof = registrationInternalProof("Person@Example.test");
    expect(verifyRegistrationInternalProof("person@example.test", proof)).toBe(true);
    expect(verifyRegistrationInternalProof("other@example.test", proof)).toBe(false);
    const tampered = `${proof.slice(0, -1)}${proof.endsWith("0") ? "1" : "0"}`;
    expect(verifyRegistrationInternalProof("person@example.test", tampered)).toBe(false);
    vi.unstubAllEnvs();
  });
});
