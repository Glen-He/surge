import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./client-ip";

describe("可信代理客户端地址", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("忽略客户端伪造的左侧地址，并剥离配置中的代理链", () => {
    vi.stubEnv("TRUSTED_PROXIES", "127.0.0.1,10.0.0.0/8");
    expect(clientIp(new Headers({
      "x-forwarded-for": "attacker-value, 198.51.100.8, 10.1.2.3, 127.0.0.1",
    }))).toBe("198.51.100.8");
  });

  it("不越过无效的可信边界段寻找可伪造地址", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.8, invalid" }))).toBe("unknown");
    expect(clientIp(new Headers({ "x-forwarded-for": "...., :::" }))).toBe("unknown");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7" }))).toBe("unknown");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("IPv4 映射地址和同一 IPv6 子网使用相同桶", () => {
    const ip = (value: string) => clientIp(new Headers({ "x-forwarded-for": value }));
    expect(ip("::ffff:203.0.113.7")).toBe(ip("203.0.113.7"));
    expect(ip("2001:DB8::1")).toBe(ip("2001:0db8:0:0::abcd"));
  });
});
