export type DatedReport = { slug: string; date: string };
export type ReportDropPosition = "before" | "after";

/**
 * 把一个项目移动到目标项目的位置；跨日期时继承目标项目的日期。
 * 保留数组其余部分的相对顺序，供拖拽的乐观更新与持久化共同使用。
 */
export function moveReportToTargetDate<T extends DatedReport>(
  items: T[],
  movingSlug: string,
  targetSlug: string,
  position?: ReportDropPosition,
): T[] {
  if (movingSlug === targetSlug) return items;
  const from = items.findIndex((item) => item.slug === movingSlug);
  const to = items.findIndex((item) => item.slug === targetSlug);
  if (from < 0 || to < 0) return items;

  const targetDate = items[to].date.slice(0, 10);
  const dropPosition = position ?? (from < to ? "after" : "before");
  const moved = { ...items[from], date: targetDate };
  const next = [...items];
  next.splice(from, 1);
  const targetAfterRemoval = next.findIndex((item) => item.slug === targetSlug);
  const insertAt =
    dropPosition === "before" ? targetAfterRemoval : targetAfterRemoval + 1;
  next.splice(insertAt, 0, moved);
  const unchanged = next.every(
    (item, index) =>
      item.slug === items[index].slug && item.date === items[index].date,
  );
  if (unchanged) return items;
  return next;
}
