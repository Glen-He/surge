import { getApiSession } from "@/features/auth/api-session";
import { db } from "@/infrastructure/database/client";

export const dynamic = "force-dynamic";

// 撤销分享：只允许属主操作（JOIN reports 校验归属）。
// 撤销 = 物理删除记录，token 随之失效（公开端点查不到即 404）。
// 用户明确要求撤销后不在列表保留“已撤销”记录。
// 同时递增报告 capability_epoch：已签发的 capability（最长 6h TTL）
// 立即整体失效——否则撤销只拦住「新签发」，拦不住「已持有」。
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ report_id: string }>(
      `DELETE FROM report_shares s
       USING reports r
       WHERE r.id = s.report_id
         AND r.user_id = $1
         AND s.id = $2
       RETURNING s.report_id`,
      [session.user.id, id],
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return Response.json({ error: "分享不存在" }, { status: 404 });
    }
    const updated = await client.query(
      `UPDATE reports SET capability_epoch = capability_epoch + 1
       WHERE id = $1`,
      [r.rows[0].report_id],
    );
    if (updated.rowCount !== 1) {
      throw new Error("report disappeared while revoking share");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return Response.json({ ok: true });
}
