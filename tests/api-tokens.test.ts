import { describe, expect, it } from "vitest";
import { generateApiToken } from "../lib/api-tokens";

// API 令牌：格式与熵（哈希/校验逻辑依赖 DB，在端到端层面验证）
describe("generateApiToken", () => {
  it("格式：sgk_ 前缀 + 43 位 base64url（32 字节）", () => {
    const t = generateApiToken();
    expect(t).toMatch(/^sgk_[A-Za-z0-9_-]{43}$/);
  });

  it("不含 + / = 等非 URL 安全字符", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateApiToken()).not.toMatch(/[+/=]/);
    }
  });

  it("每次生成不同（100 次无碰撞）", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateApiToken()));
    expect(set.size).toBe(100);
  });
});
