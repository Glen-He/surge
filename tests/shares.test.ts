import { describe, expect, it } from "vitest";
import {
  generateShareId,
  generateShareToken,
  hashSharePassword,
  unlockProof,
  verifySharePassword,
} from "@/lib/shares";
import {
  boardUnlockCookieName,
  boardUnlockProof,
  normalizeBoardTitle,
  verifyBoardUnlockProof,
} from "@/lib/share-boards";

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
  it("哈希-验证往返", async () => {
    const stored = await hashSharePassword("s3cret!");
    expect(stored.startsWith("scrypt$")).toBe(true);
    await expect(verifySharePassword("s3cret!", stored)).resolves.toBe(true);
  });

  it("错误密码不通过", async () => {
    const stored = await hashSharePassword("s3cret!");
    await expect(verifySharePassword("s3cret", stored)).resolves.toBe(false);
    await expect(verifySharePassword("", stored)).resolves.toBe(false);
  });

  it("同一密码两次哈希盐不同（存储值不同）", async () => {
    const [a, b] = await Promise.all([
      hashSharePassword("abc"),
      hashSharePassword("abc"),
    ]);
    expect(a).not.toBe(b);
  });

  it("畸形存储值返回 false 而非抛错", async () => {
    await expect(verifySharePassword("abc", "")).resolves.toBe(false);
    await expect(verifySharePassword("abc", "plain")).resolves.toBe(false);
    await expect(verifySharePassword("abc", "scrypt$only")).resolves.toBe(false);
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

describe("分享面板边界", () => {
  it("规范化名称并拒绝空名称或超长名称", () => {
    expect(normalizeBoardTitle("  课题组   周会  ")).toBe("课题组 周会");
    expect(normalizeBoardTitle("   ")).toBeNull();
    expect(normalizeBoardTitle("面".repeat(41))).toBeNull();
  });

  it("面板解锁凭证与单独链接分属不同命名空间", () => {
    const token = "same-token";
    const proof = boardUnlockProof(token);
    expect(proof).not.toBe(unlockProof(token));
    expect(verifyBoardUnlockProof(token, proof)).toBe(true);
    expect(verifyBoardUnlockProof(token, unlockProof(token))).toBe(false);
    expect(boardUnlockCookieName(token)).toBe(`board_${token}`);
  });
});
