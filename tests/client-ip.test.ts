import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

describe("clientIp", () => {
  it("从代理追加链末端取有效 IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "attacker-value, 198.51.100.8, 2001:db8::1",
    });
    expect(clientIp(headers)).toBe("2001:db8::1");
  });

  it("拒绝仅由 IP 字符组成但语法无效的值", () => {
    const headers = new Headers({ "x-forwarded-for": "...., :::" });
    expect(clientIp(headers)).toBe("unknown");
  });

  it("在没有 X-Forwarded-For 时使用 X-Real-IP", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.7" });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });
});
