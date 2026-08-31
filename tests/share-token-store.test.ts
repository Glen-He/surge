import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptSharePasscode,
  decryptShareToken,
  encryptSharePasscode,
  encryptShareToken,
  shareTokenHash,
} from "@/lib/share-token-store";

describe("分享令牌持久化保护", () => {
  beforeEach(() =>
    vi.stubEnv(
      "SHARE_TOKEN_ENCRYPTION_KEY",
      "share-test-token-encryption-key-at-least-32-characters",
    ),
  );
  afterEach(() => vi.unstubAllEnvs());

  it("AES-GCM 加密可往返且同一令牌每次密文不同", () => {
    const first = encryptShareToken("BearerToken123");
    const second = encryptShareToken("BearerToken123");
    expect(first).not.toBe(second);
    expect(decryptShareToken(first)).toBe("BearerToken123");
    expect(decryptShareToken(second)).toBe("BearerToken123");
  });

  it("提取码使用独立派生密钥加密并可往返", () => {
    const tokenCiphertext = encryptShareToken("A7B2");
    const passcodeCiphertext = encryptSharePasscode("A7B2");
    expect(passcodeCiphertext).not.toBe(tokenCiphertext);
    expect(decryptSharePasscode(passcodeCiphertext)).toBe("A7B2");
    expect(() => decryptShareToken(passcodeCiphertext)).toThrow();
  });

  it("查询指纹稳定但不包含明文", () => {
    const hash = shareTokenHash("BearerToken123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("BearerToken123");
    expect(shareTokenHash("BearerToken123")).toBe(hash);
  });

  it("密文被篡改时拒绝解密", () => {
    const encrypted = encryptShareToken("BearerToken123");
    const parts = encrypted.split(".");
    const ciphertext = Buffer.from(parts[3], "base64url");
    ciphertext[0] ^= 1;
    parts[3] = ciphertext.toString("base64url");
    const tampered = parts.join(".");
    expect(() => decryptShareToken(tampered)).toThrow();
  });

  it("不再从 SHARE_SECRET 回退派生加密密钥", () => {
    vi.stubEnv("SHARE_TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("SHARE_SECRET", "legacy-share-secret-at-least-32-characters");
    expect(() => encryptShareToken("BearerToken123")).toThrow(
      "SHARE_TOKEN_ENCRYPTION_KEY",
    );
  });
});
