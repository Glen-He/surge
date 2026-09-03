import { describe, expect, it } from "vitest";
import { toChineseError } from "@/features/auth/auth-errors";

describe("认证错误文案边界", () => {
  it("只翻译白名单内的 better-auth 错误码", () => {
    expect(toChineseError({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "邮箱或密码错误",
    );
    expect(toChineseError({ code: "UNKNOWN_ERROR" })).toBe(
      "操作失败，请稍后重试",
    );
  });

  it("缺少结构化错误码时不透传上游 message", () => {
    expect(
      toChineseError(
        { message: "不应直接展示的内部信息" } as { code?: string },
      ),
    ).toBe("操作失败，请稍后重试");
  });

  it("允许不同 UI 边界提供自己的安全兜底文案", () => {
    expect(toChineseError({ code: "UNKNOWN_ERROR" }, "重置失败")).toBe(
      "重置失败",
    );
    expect(toChineseError({ code: "EXPIRED_TOKEN" }, "重置失败")).toBe(
      "链接已过期，请重新发起重置",
    );
  });
});
