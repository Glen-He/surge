import { afterEach, describe, expect, it, vi } from "vitest";
import { generateApiToken, parseApiBearerToken } from "@/features/account/api-tokens";
import { decryptApiToken, encryptApiToken } from "@/features/account/api-token-store";

describe("API Bearer token 解析", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("接受大小写不敏感的 Bearer scheme，但 token 前缀保持严格", () => {
    const token = generateApiToken();
    expect(parseApiBearerToken(`Bearer ${token}`)).toBe(token);
    expect(parseApiBearerToken(`bearer\t${token}`)).toBe(token);
    expect(parseApiBearerToken(`Bearer ${token.replace("sgk_", "SGK_")}`)).toBeNull();
  });

  it("在哈希和数据库查询前拒绝异常长度与字符", () => {
    expect(parseApiBearerToken("Bearer sgk_short")).toBeNull();
    expect(parseApiBearerToken(`Bearer sgk_${"A".repeat(10_000)}`)).toBeNull();
    expect(parseApiBearerToken(`Basic ${generateApiToken()}`)).toBeNull();
    expect(parseApiBearerToken(null)).toBeNull();
  });

  it("API 令牌使用独立密钥加密后可供所有者再次查看", () => {
    vi.stubEnv(
      "API_TOKEN_ENCRYPTION_KEY",
      "api-token-test-encryption-key-at-least-32-characters",
    );
    const token = generateApiToken();
    const encrypted = encryptApiToken(token);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(token);
    expect(decryptApiToken(encrypted)).toBe(token);
  });
});
