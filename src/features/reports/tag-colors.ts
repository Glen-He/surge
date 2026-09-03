// 标签色板（浅色系）：低饱和浅底 + 同色系深字，与卡片整体浅色风格一致
// swatch 为选择器展示用的中间色（介于 bg 与 text 之间，太浅难分辨、太深显浓重）
export const TAG_PALETTE = [
  { name: "Red", bg: "#FEE2E2", text: "#B91C1C", swatch: "#F87171" },
  { name: "Orange", bg: "#FFEDD5", text: "#C2410C", swatch: "#FB923C" },
  { name: "Yellow", bg: "#FEF3C7", text: "#92400E", swatch: "#FBBF24" },
  { name: "Green", bg: "#DCFCE7", text: "#166534", swatch: "#4ADE80" },
  { name: "Blue", bg: "#DBEAFE", text: "#1D4ED8", swatch: "#60A5FA" },
  { name: "Purple", bg: "#F3E8FF", text: "#7E22CE", swatch: "#C084FC" },
  { name: "Gray", bg: "#F1F5F9", text: "#475569", swatch: "#94A3B8" },
] as const;

export type TagColor = (typeof TAG_PALETTE)[number]["bg"];

// 表单默认色（新建项目未手动选择时）：红
export const DEFAULT_TAG_COLOR: TagColor = "#FEE2E2";

// 是否为合法色板颜色
export function isTagColor(v: string | null | undefined): v is TagColor {
  return TAG_PALETTE.some((c) => c.bg === v);
}

/** 数据库已通过约束保证色值合法；违反不变量时立即失败，禁止静默伪造颜色。 */
export function requireTagColor(value: string): TagColor {
  if (!isTagColor(value)) {
    throw new Error("report tag color violates database invariant");
  }
  return value;
}

// 该底色上的文字颜色（用于标签 chip 渲染）
export function tagTextColor(bg: TagColor): string {
  const color = TAG_PALETTE.find((c) => c.bg === bg);
  if (!color) throw new Error("report tag color violates palette invariant");
  return color.text;
}

// 该底色对应的选择器展示色（中间色调）
export function tagSwatchColor(bg: TagColor): string {
  const color = TAG_PALETTE.find((c) => c.bg === bg);
  if (!color) throw new Error("report tag color violates palette invariant");
  return color.swatch;
}
