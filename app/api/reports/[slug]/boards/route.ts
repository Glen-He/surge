import { getApiSession } from "@/lib/api-session";
import { listShareBoardsForReport } from "@/lib/share-boards";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { slug } = await params;
  const boards = await listShareBoardsForReport(session.user.id, slug);
  if (!boards) return Response.json({ error: "报告不存在" }, { status: 404 });
  return Response.json({ boards });
}
