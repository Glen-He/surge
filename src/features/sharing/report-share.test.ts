import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateShareId,
  generateSharePasscode,
  generateShareToken,
  hashSharePassword,
  shareStatus,
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
import { boardExpiryFromDays, normalizeBoardTitle } from "@/features/sharing/share-board";
import {
  SHARE_EXPIRY_OPTIONS,
  nearestShareExpiryDays,
  parseShareExpiryDays,
  shareExpiryDate,
} from "@/features/sharing/share-expiry";

beforeEach(() => {
  vi.stubEnv("SHARE_SECRET", "share-proof-test-secret-at-least-32-characters");
});

afterEach(() => vi.unstubAllEnvs());

describe("generateShareToken", () => {
  it("生成长度 8 的小写字母数字 token", () => {
    const t = generateShareToken();
    expect(t).toMatch(/^[a-z0-9]{8}$/);
  });

  it("支持自定义长度", () => {
    expect(generateShareToken(10)).toMatch(/^[a-z0-9]{10}$/);
  });

  it("大量生成不重复", () => {
    const set = new Set(Array.from({ length: 2000 }, () => generateShareToken()));
    expect(set.size).toBe(2000);
  });

  it("公开入口仅接受八位小写字母数字，旧 token 一律无效", () => {
    expect(isValidShareToken("a1b2c3d4")).toBe(true);
    expect(isValidShareToken("a".repeat(22))).toBe(false);
    expect(isValidShareToken("A1b2c3d4")).toBe(false);
    expect(isValidShareToken("a1b2c3d_")).toBe(false);
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

  it("复制分享内容时只包含链接，并将提取码放入 URL fragment", () => {
    expect(shareClipboardText("https://example.test/share/token", "A7B2")).toBe(
      "https://example.test/share/token#pwd=A7B2",
    );
    expect(shareClipboardText("https://example.test/share/token", null)).toBe(
      "https://example.test/share/token",
    );
  });

  it("提取码使用不会发送到服务端的 URL fragment，并能严格解析", () => {
    expect(shareUrlWithPasscode("https://example.test/board/token", "A7B2")).toBe(
      "https://example.test/board/token#pwd=A7B2",
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
  it("分享状态优先展示暂停，其次过期", () => {
    const now = Date.now();
    expect(shareStatus({ expires_at: null, disabled_at: null })).toBe("active");
    expect(shareStatus({ expires_at: null })).toBe("active");
    expect(
      shareStatus({ expires_at: new Date(now - 1000), disabled_at: null }),
    ).toBe("expired");
    expect(
      shareStatus({ expires_at: null, disabled_at: new Date(now) }),
    ).toBe("paused");
    expect(
      shareStatus({
        expires_at: new Date(now - 1000),
        disabled_at: new Date(now),
      }),
    ).toBe("paused");
  });

  it("规范化名称并拒绝空名称或超长名称", () => {
    expect(normalizeBoardTitle("  课题组   周会  ")).toBe("课题组 周会");
    expect(normalizeBoardTitle("   ")).toBeNull();
    expect(normalizeBoardTitle("面".repeat(41))).toBeNull();
  });

  it("有效期只接受预设档位并按天数换算到期时刻", () => {
    expect(parseShareExpiryDays(0)).toBe(0);
    expect(parseShareExpiryDays(90)).toBe(90);
    expect(parseShareExpiryDays(3)).toBeNull();
    expect(parseShareExpiryDays("7")).toBeNull();
    expect(parseShareExpiryDays(undefined)).toBeNull();
    expect(shareExpiryDate(0)).toBeNull();
    expect(shareExpiryDate(7, 0)).toEqual(new Date(7 * 24 * 60 * 60 * 1000));
  });

  it("下拉选项与档位表一致（永久 / 1 / 7 / 30 / 90）", () => {
    expect(SHARE_EXPIRY_OPTIONS).toEqual([
      { value: 0, label: "永久有效" },
      { value: 1, label: "1 天" },
      { value: 7, label: "7 天" },
      { value: 30, label: "30 天" },
      { value: 90, label: "90 天" },
    ]);
  });

  it("已设置到期时间反推最接近档位，永久与已过期按永久处理", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 8, 27);
    expect(nearestShareExpiryDays(null, now)).toBe(0);
    expect(nearestShareExpiryDays(new Date(now - 1), now)).toBe(0);
    expect(nearestShareExpiryDays(new Date(now + 7 * day), now)).toBe(7);
    expect(nearestShareExpiryDays(new Date(now + 6 * day), now)).toBe(7);
    expect(nearestShareExpiryDays(new Date(now + 25 * day), now)).toBe(30);
    expect(nearestShareExpiryDays(new Date(now + 200 * day), now)).toBe(90);
  });

  it("面板档位换算到期时刻，非法档位抛业务错误", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(boardExpiryFromDays(30)).toEqual(new Date(Date.now() + 30 * day));
    expect(boardExpiryFromDays(0)).toBeNull();
    expect(() => boardExpiryFromDays(3)).toThrowError(/BOARD_EXPIRY_INVALID/);
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
