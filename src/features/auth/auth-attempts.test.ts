import { afterEach, describe, expect, it, vi } from "vitest";
import {
  passwordLoginInternalProof,
  verifyPasswordLoginInternalProof,
} from "@/features/auth/auth-attempts";

describe("密码登录内部证明", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("绑定邮箱并拒绝直接篡改", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "login-proof-test-secret-at-least-32-chars");
    const proof = passwordLoginInternalProof("Person@Example.test");
    expect(verifyPasswordLoginInternalProof("person@example.test", proof)).toBe(true);
    expect(verifyPasswordLoginInternalProof("other@example.test", proof)).toBe(false);
  });
});
