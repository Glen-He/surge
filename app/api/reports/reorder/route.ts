import { getApiSession } from "@/lib/api-session";
import { getReportsByUser, reorderReports } from "@/lib/reports-db";

export const dynamic = "force-dynamic";

// 拖拽调序持久化：{ slugs: string[] } 为该用户全部项目的完整顺序
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const slugs = body?.slugs;
  if (!Array.isArray(slugs) || slugs.some((s) => typeof s !== "string")) {
    return Response.json({ error: "参数无效" }, { status: 400 });
  }

  const mine = await getReportsByUser(session.user.id);
  const mineSet = new Set(mine.map((r) => r.slug));
  const valid =
    slugs.length === mineSet.size &&
    new Set(slugs).size === slugs.length &&
    slugs.every((s) => mineSet.has(s));
  if (!valid) {
    return Response.json({ error: "排序与项目列表不匹配" }, { status: 400 });
  }

  await reorderReports(session.user.id, slugs);
  return Response.json({ ok: true });
}
