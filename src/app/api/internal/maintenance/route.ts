import { timingSafeEqual } from "node:crypto";
import { runMaintenance } from "@/features/maintenance/scheduler";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.MAINTENANCE_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "未授权" }, { status: 401 });
  const ok = await runMaintenance();
  return Response.json(
    ok ? { ok: true } : { error: "维护任务未完成或已有任务正在运行" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
