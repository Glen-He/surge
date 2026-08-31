import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptShareToken,
  encryptShareToken,
  shareTokenHash,
} from "@/lib/share-token-store";

describe("分享令牌持久化保护", () => {
  beforeEach(() => vi.stubEnv("SHARE_SECRET", "share-test-secret-at-least-32-characters"));
  afterEach(() => vi.unstubAllEnvs());

  it("AES-GCM 加密可往返且同一令牌每次密文不同", () => {
    const first = encryptShareToken("BearerToken123");
    const second = encryptShareToken("BearerToken123");
    expect(first).not.toBe(second);
    expect(decryptShareToken(first)).toBe("BearerToken123");
    expect(decryptShareToken(second)).toBe("BearerToken123");
  });

  it("查询指纹稳定但不包含明文", () => {
    const hash = shareTokenHash("BearerToken123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("BearerToken123");
    expect(shareTokenHash("BearerToken123")).toBe(hash);
  });

  it("密文被篡改时拒绝解密", () => {
    const encrypted = encryptShareToken("BearerToken123");
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptShareToken(tampered)).toThrow();
  });
});
