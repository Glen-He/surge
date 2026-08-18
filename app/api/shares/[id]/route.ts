import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureOtpMigration } from "@/lib/schema";

export const dynamic = "force-dynamic";

// 撤销分享：只允许属主操作（JOIN reports 校验归属）。
// 撤销 = 物理删除记录，token 随之失效（公开端点查不到即 404）。
// 用户明确要求撤销后不在列表保留“已撤销”记录。
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  await ensureOtpMigration();

  const r = await db.query(
    `DELETE FROM report_shares s
     USING reports r
     WHERE r.id = s.report_id
       AND r.user_id = $1
       AND s.id = $2`,
    [session.user.id, id],
  );
  if (r.rowCount === 0) {
    return Response.json({ error: "分享不存在" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
