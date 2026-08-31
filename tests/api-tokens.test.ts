import { describe, expect, it } from "vitest";
import { generateApiToken, parseApiBearerToken } from "@/lib/api-tokens";

describe("API Bearer token 解析", () => {
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
});
