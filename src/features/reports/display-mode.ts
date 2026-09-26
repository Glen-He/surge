/** 报告内容的展示方式；上传内容与安全隔离规则不受模式影响。 */
export type DisplayMode = "frame" | "bare";

/** 严格验证外部输入的展示模式。 */
export function isDisplayMode(value: unknown): value is DisplayMode {
  return value === "frame" || value === "bare";
}
