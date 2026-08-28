export type DatedReport = { slug: string; date: string };
export type ReportDropPosition = "before" | "after";

export function reportDropPosition(
  items: DatedReport[],
  movingSlug: string,
  targetSlug: string,
): ReportDropPosition | null {
  const from = items.findIndex((item) => item.slug === movingSlug);
  const to = items.findIndex((item) => item.slug === targetSlug);
  if (from < 0 || to < 0 || from === to) return null;
  return from < to ? "after" : "before";
}

/**
 * 把一个项目移动到目标项目的位置；跨日期时继承目标项目的日期。
 * 保留数组其余部分的相对顺序，供拖拽的乐观更新与持久化共同使用。
 */
export function moveReportToTargetDate<T extends DatedReport>(
  items: T[],
  movingSlug: string,
  targetSlug: string,
): T[] {
  if (movingSlug === targetSlug) return items;
  const from = items.findIndex((item) => item.slug === movingSlug);
  const to = items.findIndex((item) => item.slug === targetSlug);
  if (from < 0 || to < 0) return items;

  const moved = { ...items[from], date: items[to].date.slice(0, 10) };
  const next = [...items];
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
