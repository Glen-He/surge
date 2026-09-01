import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateInviteCode,
  INVITE_CODE_ALPHABET,
  inviteCodeHasValidFormat,
  inviteCodeLookup,
  normalizeInviteCode,
} from "@/lib/registration-invites";
import {
  decryptInviteCode,
  encryptInviteCode,
} from "@/lib/invite-code-store";
import {
  inviteCodeFromFragment,
  inviteLinkFragment,
} from "@/lib/invite-link";

describe("注册邀请码", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("统一大写且严格接受六位数字或字母", () => {
    expect(normalizeInviteCode(" a1b2c3 ")).toBe("A1B2C3");
    expect(inviteCodeHasValidFormat("a1b2c3")).toBe(true);
    expect(inviteCodeHasValidFormat("A1B2C")).toBe(false);
    expect(inviteCodeHasValidFormat("A1B2-C")).toBe(false);
  });

  it("完整字符表包含数字 1 并生成固定六位码", () => {
    const codes = Array.from({ length: 20 }, () => generateInviteCode());
    expect(INVITE_CODE_ALPHABET).toContain("1");
    expect(codes.every((code) => /^[0-9A-Z]{6}$/.test(code))).toBe(true);
  });

  it("lookup 不区分大小写且不暴露明文", () => {
    vi.stubEnv("INVITE_CODE_SECRET", "invite-test-secret-at-least-32-characters");
    const upper = inviteCodeLookup("A1B2C3");
    const lower = inviteCodeLookup("a1b2c3");
    expect(upper).toBe(lower);
    expect(upper).toMatch(/^[0-9a-f]{64}$/);
    expect(upper).not.toContain("A1B2C3");
  });

  it("加密存储可供创建者回显且密文不包含邀请码", () => {
    vi.stubEnv("INVITE_CODE_SECRET", "invite-test-secret-at-least-32-characters");
    const encrypted = encryptInviteCode("A1B2C3");
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("A1B2C3");
    expect(decryptInviteCode(encrypted)).toBe("A1B2C3");
  });

  it("邀请链接使用 fragment 并可自动解析邀请码", () => {
    const fragment = inviteLinkFragment("a1b2c3");
    expect(fragment).toBe("invite=A1B2C3");
    expect(inviteCodeFromFragment(`#${fragment}`)).toBe("A1B2C3");
    expect(inviteCodeFromFragment("#invite=BAD-CODE")).toBeNull();
  });
});
