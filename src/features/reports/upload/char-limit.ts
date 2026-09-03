// 字段长度限制：按"汉字占用空间"计权 —— 全角字符（汉字/中文标点/全角符号）= 1，
// 半角字符（ASCII 字母数字/英文标点/空格）= 0.5。例：20 字上限可容纳 20 个汉字
// 或 40 个半角字符。不做截断：前端超限实时报错并拦截提交，服务端同口径校验。
export const LIMITS = {
  title: 20,
  tag: 6,
  keywords: 50,
  description: 200,
} as const;

// 全角区段：CJK 部首/汉字/兼容表意/中文标点/全角符号/全角ASCII
const FULLWIDTH_RE =
  /[\u1100-\u115F\u2E80-\u9FFF\uA960-\uA97C\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/;

/** 计算字符串的字宽（汉字 1、半角 0.5） */
export function charWeight(s: string): number {
  let w = 0;
  for (const ch of s) w += FULLWIDTH_RE.test(ch) ? 1 : 0.5;
  return w;
}
