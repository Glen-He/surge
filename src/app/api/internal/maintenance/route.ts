import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";
import { runMaintenance } from "@/features/maintenance/scheduler";

function authorized(req: Request): boolean {
  // 生产必填；本地/测试未配置时统一视为未授权
  const expected = serverEnv.MAINTENANCE_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "未授权" }, { status: 401 });
  const result = await runMaintenance();
  if (result === "ok" || result === "busy") {
    // 已有实例持有本轮租约不是失败：外部 cron 与进程内调度器会互相
    // 抢同一个窗口，返回 503 会造成无意义的告警。
    return Response.json(
      result === "ok" ? { ok: true } : { ok: true, skipped: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: "维护任务未完成" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
