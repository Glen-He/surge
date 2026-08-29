import { getApiSession } from "@/lib/api-session";
import { setBoardMembership, ShareBoardError } from "@/lib/share-boards";

export const dynamic = "force-dynamic";

async function change(
  included: boolean,
  params: Promise<{ slug: string; boardId: string }>,
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { slug, boardId } = await params;
  try {
    await setBoardMembership(session.user.id, boardId, slug, included);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PUT(
  _req: Request,
  { params }: { params: Promise<{ slug: string; boardId: string }> },
) {
  return change(true, params);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; boardId: string }> },
) {
  return change(false, params);
}
