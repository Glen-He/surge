// 标签色板（浅色系）：低饱和浅底 + 同色系深字，与卡片整体浅色风格一致
export const TAG_PALETTE = [
  { name: "Red", bg: "#FEE2E2", text: "#B91C1C" },
  { name: "Orange", bg: "#FFEDD5", text: "#C2410C" },
  { name: "Yellow", bg: "#FEF3C7", text: "#92400E" },
  { name: "Green", bg: "#DCFCE7", text: "#166534" },
  { name: "Blue", bg: "#DBEAFE", text: "#1D4ED8" },
  { name: "Purple", bg: "#F3E8FF", text: "#7E22CE" },
  { name: "Gray", bg: "#F1F5F9", text: "#475569" },
] as const;

export type TagColor = (typeof TAG_PALETTE)[number]["bg"];

// 表单默认色（新建项目未手动选择时）：红
export const DEFAULT_TAG_COLOR: TagColor = "#FEE2E2";

// 是否为合法色板颜色
export function isTagColor(v: string | null | undefined): v is TagColor {
  return TAG_PALETTE.some((c) => c.bg === v);
}

// 旧数据兜底：无 tag_color 时按标签文字哈希稳定映射到色板（同标签同色）
export function fallbackTagColor(tag: string): TagColor {
  const i =
    Math.abs([...tag].reduce((a, c) => a + c.charCodeAt(0), 0)) %
    TAG_PALETTE.length;
  return TAG_PALETTE[i].bg;
}

// 该底色上的文字颜色（用于标签 chip 渲染）
export function tagTextColor(bg: string): string {
  return TAG_PALETTE.find((c) => c.bg === bg)?.text ?? "#475569";
}
