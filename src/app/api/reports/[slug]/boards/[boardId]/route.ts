import { getApiSession } from "@/features/session/api-session";
import { setBoardMembership } from "@/features/sharing/share-board";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/features/sharing/share-board-errors";

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
      return shareBoardErrorResponse(error);
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
