import { afterEach, describe, expect, it, vi } from "vitest";
import { internalAuthProof, verifyInternalAuthProof } from "./internal-auth-proof";

describe("内部认证凭证", () => {
  afterEach(() => vi.useRealTimers());

  it("绑定用途与主体，签发同一操作时仍产生不同凭证", () => {
    const proof = internalAuthProof("set-password", "session-a");
    expect(verifyInternalAuthProof("set-password", "session-a", proof)).toBe(true);
    expect(verifyInternalAuthProof("end-session", "session-a", proof)).toBe(false);
    expect(verifyInternalAuthProof("set-password", "session-b", proof)).toBe(false);
    expect(internalAuthProof("set-password", "session-a")).not.toBe(proof);
  });

  it("拒绝过期、未来时间、篡改和旧格式", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T00:00:00Z"));
    const proof = internalAuthProof("guest-login", "");
    vi.advanceTimersByTime(59_000);
    expect(verifyInternalAuthProof("guest-login", "", proof)).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(verifyInternalAuthProof("guest-login", "", proof)).toBe(false);
    vi.setSystemTime(new Date("2026-09-27T23:59:59Z"));
    expect(verifyInternalAuthProof("guest-login", "", proof)).toBe(false);
    expect(verifyInternalAuthProof("guest-login", "", "a".repeat(64))).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(verifyInternalAuthProof("guest-login", "", `${proof.slice(0, -1)}z`)).toBe(false);
  });
});
