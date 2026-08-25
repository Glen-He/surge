import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAG_COLOR,
  TAG_PALETTE,
  fallbackTagColor,
  isTagColor,
  tagSwatchColor,
  tagTextColor,
} from "@/lib/tag-colors";

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

  it("fallbackTagColor：同标签稳定同色，输出在色板内", () => {
    expect(fallbackTagColor("周报")).toBe(fallbackTagColor("周报"));
    for (const tag of ["a", "b", "绩效", "季度总结"]) {
      expect(isTagColor(fallbackTagColor(tag))).toBe(true);
    }
  });

  it("tagTextColor / tagSwatchColor：已知色返回对应值，未知色返回灰兜底", () => {
    const blue = TAG_PALETTE.find((c) => c.name === "Blue")!;
    expect(tagTextColor(blue.bg)).toBe(blue.text);
    expect(tagSwatchColor(blue.bg)).toBe(blue.swatch);
    expect(tagTextColor("#000000")).toBe("#475569");
    expect(tagSwatchColor("#000000")).toBe("#94A3B8");
  });
});
