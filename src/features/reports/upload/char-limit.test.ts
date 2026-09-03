import { describe, expect, it } from "vitest";
import { LIMITS, charWeight } from "@/features/reports/upload/char-limit";

describe("charWeight 字宽计算", () => {
  it("全角汉字计 1", () => {
    expect(charWeight("一二三四")).toBe(4);
  });

  it("半角 ASCII 计 0.5", () => {
    expect(charWeight("abcd")).toBe(2);
    expect(charWeight("12345678")).toBe(4);
  });

  it("中英混排", () => {
    expect(charWeight("a一b二")).toBe(3);
  });

  it("中文标点/全角符号计 1", () => {
    expect(charWeight("，。！")).toBe(3);
    expect(charWeight("ＡＢ")).toBe(2);
  });

  it("空字符串为 0", () => {
    expect(charWeight("")).toBe(0);
  });

  it("限制值与产品约定一致（标题 20 / 标签 6 / 关键词 50 / 简介 200）", () => {
    expect(LIMITS).toEqual({ title: 20, tag: 6, keywords: 50, description: 200 });
  });
});
