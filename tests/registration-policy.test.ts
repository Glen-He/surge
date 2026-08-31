import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registrationInternalProof,
  registrationIsOpen,
  verifyRegistrationInternalProof,
} from "@/lib/registration-policy";

describe("注册策略", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("生产环境默认关闭，只有显式 open 才开放", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REGISTRATION_MODE", "");
    expect(registrationIsOpen()).toBe(false);
    vi.stubEnv("REGISTRATION_MODE", "open");
    expect(registrationIsOpen()).toBe(true);
  });

  it("内部注册证明绑定邮箱并拒绝篡改", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "registration-test-secret-at-least-32-chars");
    const proof = registrationInternalProof("Person@Example.test");
    expect(verifyRegistrationInternalProof("person@example.test", proof)).toBe(true);
    expect(verifyRegistrationInternalProof("other@example.test", proof)).toBe(false);
    const tampered = `${proof.slice(0, -1)}${proof.endsWith("0") ? "1" : "0"}`;
    expect(verifyRegistrationInternalProof("person@example.test", tampered)).toBe(false);
  });
});
