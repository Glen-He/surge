import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateShareId,
  generateSharePasscode,
  generateShareToken,
  hashSharePassword,
  unlockProof,
  verifySharePassword,
  isValidSharePasscode,
  isValidShareToken,
} from "@/features/sharing/report-share";
import {
  shareClipboardText,
  sharePasscodeFromHash,
  shareUrlWithPasscode,
} from "@/features/sharing/share-copy";
import { boardUnlockCookieName, boardUnlockProof, verifyBoardUnlockProof } from "@/features/sharing/public-share-board";
import { normalizeBoardTitle, parseBoardExpiry } from "@/features/sharing/share-board";

beforeEach(() => {
  vi.stubEnv("SHARE_SECRET", "share-proof-test-secret-at-least-32-characters");
});

afterEach(() => vi.unstubAllEnvs());

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

  it("公开入口只接受当前版本的 22 位 base62 token", () => {
    expect(isValidShareToken("A1b2C3d4E5f6G7h8I9j0K1")).toBe(true);
    expect(isValidShareToken("short")).toBe(false);
    expect(isValidShareToken("A1b2C3d4E5f6G7h8I9j0K_")).toBe(false);
    expect(isValidShareToken("A".repeat(10_000))).toBe(false);
  });
});

describe("generateShareId", () => {
  it("生成 32 位 hex", () => {
    expect(generateShareId()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("4 位分享提取码", () => {
  it("由密码学随机源生成 4 位字母数字", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateSharePasscode()).toMatch(/^[A-Z0-9]{4}$/);
    }
  });

  it("严格拒绝长度或字符不符合的值", () => {
    expect(isValidSharePasscode("A7B2")).toBe(true);
    expect(isValidSharePasscode("abc")).toBe(false);
    expect(isValidSharePasscode("abcd5")).toBe(false);
    expect(isValidSharePasscode("ab_2")).toBe(false);
  });

  it("复制内容的链接自带提取码，同时保留独立提取码文案", () => {
    expect(shareClipboardText("https://example.test/s/token", "A7B2")).toBe(
      "链接：https://example.test/s/token#pwd=A7B2\n提取码：A7B2",
    );
    expect(shareClipboardText("https://example.test/s/token", null)).toBe(
      "https://example.test/s/token",
    );
  });

  it("提取码使用不会发送到服务端的 URL fragment，并能严格解析", () => {
    expect(shareUrlWithPasscode("https://example.test/b/token", "A7B2")).toBe(
      "https://example.test/b/token#pwd=A7B2",
    );
    expect(sharePasscodeFromHash("#pwd=a7b2")).toBe("A7B2");
    expect(sharePasscodeFromHash("#pwd=TOO-LONG")).toBeNull();
    expect(sharePasscodeFromHash("#other=A7B2")).toBeNull();
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

  it("有效期严格校验日历日并按上海时间当日末到期", () => {
    expect(parseBoardExpiry("2026-02-30", 0)).toBe("invalid");
    expect(parseBoardExpiry("not-a-date", 0)).toBe("invalid");
    expect(parseBoardExpiry("2026-08-31", 0)).toEqual(
      new Date("2026-08-31T23:59:59.999+08:00"),
    );
  });

  it("面板解锁凭证与单独链接分属不同命名空间", () => {
    const token = "same-token";
    const proof = boardUnlockProof(token, 0);
    expect(proof).not.toBe(unlockProof(token));
    expect(verifyBoardUnlockProof(token, 0, proof)).toBe(true);
    expect(verifyBoardUnlockProof(token, 0, unlockProof(token))).toBe(false);
    expect(verifyBoardUnlockProof(token, 1, proof)).toBe(false);
    expect(boardUnlockCookieName(token)).toBe(`board_${token}`);
  });
});
