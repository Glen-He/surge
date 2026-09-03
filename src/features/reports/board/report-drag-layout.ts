export type DatedReport = { slug: string; date: string };

export type ReportOrderItem = Pick<DatedReport, "slug" | "date">;

export function reportDate(item: DatedReport): string {
  return item.date.slice(0, 10);
}

/**
 * 把项目移动到指定日期内的插入槽；targetIndex 是移除当前项目后的组内索引。
 * 日期分组始终按日期倒序排列，同一天内保留数组顺序。
 */
export function moveReportToDateIndex<T extends DatedReport>(
  items: T[],
  movingSlug: string,
  targetDate: string,
  targetIndex: number,
): T[] {
  const from = items.findIndex((item) => item.slug === movingSlug);
  if (from < 0) return items;

  const moving = { ...items[from], date: targetDate };
  const remaining = items.filter((item) => item.slug !== movingSlug);
  const targetItems = remaining.filter(
    (item) => reportDate(item) === targetDate,
  );
  const safeIndex = Math.max(0, Math.min(targetIndex, targetItems.length));

  let insertAt: number;
  if (targetItems.length > 0) {
    if (safeIndex === targetItems.length) {
      const lastTarget = targetItems[targetItems.length - 1];
      insertAt = remaining.findIndex((item) => item.slug === lastTarget.slug) + 1;
    } else {
      insertAt = remaining.findIndex(
        (item) => item.slug === targetItems[safeIndex].slug,
      );
    }
  } else {
    const firstOlderDate = remaining.findIndex(
      (item) => reportDate(item) < targetDate,
    );
    insertAt = firstOlderDate < 0 ? remaining.length : firstOlderDate;
  }

  const next = [...remaining];
  next.splice(insertAt, 0, moving);
  const unchanged = next.every(
    (item, index) =>
      item.slug === items[index]?.slug &&
      reportDate(item) === reportDate(items[index]),
  );
  return unchanged ? items : next;
}

export function sameReportOrder(
  left: DatedReport[],
  right: DatedReport[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.slug === right[index]?.slug &&
        reportDate(item) === reportDate(right[index]),
    )
  );
}

export function reportOrderItems(items: DatedReport[]): ReportOrderItem[] {
  return items.map((item) => ({ slug: item.slug, date: reportDate(item) }));
}

/** 使用服务器返回的顺序重新排列本地视图模型，并同步日期。 */
export function applyReportOrder<T extends DatedReport>(
  items: T[],
  order: ReportOrderItem[],
): T[] | null {
  if (items.length !== order.length) return null;
  const bySlug = new Map(items.map((item) => [item.slug, item]));
  const next: T[] = [];
  for (const ordered of order) {
    const item = bySlug.get(ordered.slug);
    if (!item) return null;
    next.push({ ...item, date: ordered.date });
  }
  return next;
}
