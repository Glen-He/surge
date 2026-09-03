import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAG_COLOR,
  TAG_PALETTE,
  isTagColor,
  requireTagColor,
  tagSwatchColor,
  tagTextColor,
} from "@/features/reports/tag-colors";

describe("标签色板", () => {
  it("7 色齐全，bg/text/swatch 均为合法 hex 且互不相同", () => {
    expect(TAG_PALETTE).toHaveLength(7);
    for (const c of TAG_PALETTE) {
      expect(c.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(new Set([c.bg, c.text, c.swatch]).size).toBe(3);
    }
  });

  it("默认色在色板内", () => {
    expect(isTagColor(DEFAULT_TAG_COLOR)).toBe(true);
  });

  it("isTagColor 拒绝非法值", () => {
    expect(isTagColor("#FF0000")).toBe(false);
    expect(isTagColor(null)).toBe(false);
    expect(isTagColor("")).toBe(false);
  });

  it("requireTagColor 只接受数据库色板约束允许的值", () => {
    expect(requireTagColor(DEFAULT_TAG_COLOR)).toBe(DEFAULT_TAG_COLOR);
    expect(() => requireTagColor("#FF0000")).toThrow(
      "report tag color violates database invariant",
    );
  });

  it("tagTextColor / tagSwatchColor 返回色板定义", () => {
    const blue = TAG_PALETTE.find((c) => c.name === "Blue")!;
    expect(tagTextColor(blue.bg)).toBe(blue.text);
    expect(tagSwatchColor(blue.bg)).toBe(blue.swatch);
  });
});
