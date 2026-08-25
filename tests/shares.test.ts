import { describe, expect, it } from "vitest";
import {
  generateShareId,
  generateShareToken,
  hashSharePassword,
  unlockProof,
  verifySharePassword,
} from "@/lib/shares";

describe("generateShareToken", () => {
  it("生成长度 22 的 base62 token", () => {
    const t = generateShareToken();
    expect(t).toMatch(/^[A-Za-z0-9]{22}$/);
  });

  it("支持自定义长度", () => {
    expect(generateShareToken(8)).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it("大量生成不重复", () => {
    const set = new Set(Array.from({ length: 2000 }, () => generateShareToken()));
    expect(set.size).toBe(2000);
  });
});

describe("generateShareId", () => {
  it("生成 32 位 hex", () => {
    expect(generateShareId()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("分享密码 scrypt 哈希", () => {
  it("哈希-验证往返", () => {
    const stored = hashSharePassword("s3cret!");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifySharePassword("s3cret!", stored)).toBe(true);
  });

  it("错误密码不通过", () => {
    const stored = hashSharePassword("s3cret!");
    expect(verifySharePassword("s3cret", stored)).toBe(false);
    expect(verifySharePassword("", stored)).toBe(false);
  });

  it("同一密码两次哈希盐不同（存储值不同）", () => {
    expect(hashSharePassword("abc")).not.toBe(hashSharePassword("abc"));
  });

  it("畸形存储值返回 false 而非抛错", () => {
    expect(verifySharePassword("abc", "")).toBe(false);
    expect(verifySharePassword("abc", "plain")).toBe(false);
    expect(verifySharePassword("abc", "scrypt$only")).toBe(false);
  });
});

describe("unlockProof（密码门解锁凭证）", () => {
  it("确定性：同 token 同结果，64 位 hex", () => {
    const a = unlockProof("tok123");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(unlockProof("tok123")).toBe(a);
  });

  it("不同 token 凭证不同", () => {
    expect(unlockProof("tokA")).not.toBe(unlockProof("tokB"));
  });
});
