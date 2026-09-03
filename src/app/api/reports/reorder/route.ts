import { getApiSession } from "@/features/session/api-session";
import { getReportsByUser, reorderReports } from "@/features/reports/data/reports-db";

export const dynamic = "force-dynamic";

type OrderItem = { slug: string; date: string };

function isOrderItem(value: unknown): value is OrderItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.slug === "string" &&
    typeof item.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date)
  );
}

// 拖拽持久化：日期决定分组顺序，同一天内由 items 顺序决定；
// 拖到另一日期的卡片上时，客户端会把该项目日期改成目标日期。
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const items: unknown = body?.items;
  const baseItems: unknown = body?.baseItems;
  if (
    !Array.isArray(items) ||
    !items.every(isOrderItem) ||
    !Array.isArray(baseItems) ||
    !baseItems.every(isOrderItem)
  ) {
    return Response.json({ error: "参数无效" }, { status: 400 });
  }

  const mine = await getReportsByUser(session.user.id);
  const mineSet = new Set(mine.map((report) => report.slug));
  const allowedDates = new Set(mine.map((report) => report.date.slice(0, 10)));
  const slugs = items.map((item) => item.slug);
  const baseSlugs = baseItems.map((item) => item.slug);
  const valid =
    items.length === mineSet.size &&
    baseItems.length === mineSet.size &&
    new Set(slugs).size === slugs.length &&
    new Set(baseSlugs).size === baseSlugs.length &&
    items.every(
      (item) => mineSet.has(item.slug) && allowedDates.has(item.date),
    ) &&
    baseItems.every(
      (item) => mineSet.has(item.slug) && allowedDates.has(item.date),
    );
  if (!valid) {
    return Response.json({ error: "排序与项目列表不匹配" }, { status: 400 });
  }

  const result = await reorderReports(session.user.id, items, baseItems);
  if (result !== "updated") {
    const current = await getReportsByUser(session.user.id);
    return Response.json(
      {
        error: "项目列表已发生变化，请刷新后重试",
        items: current.map((report) => ({
          slug: report.slug,
          date: report.date.slice(0, 10),
        })),
      },
      { status: 409 },
    );
  }
  return Response.json({ ok: true });
}
