import { getApiSession } from "@/features/session/api-session";
import { deleteShareBoard } from "@/features/sharing/share-board";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/features/sharing/share-board-errors";
import { updateShareBoardSettings } from "@/features/sharing/update-share-board-settings";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await updateShareBoardSettings({
      userId: session.user.id,
      boardId: id,
      settings: body,
    });
    return Response.json({ ok: true, passcode: result.passcode });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return shareBoardErrorResponse(error);
    }
    throw error;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteShareBoard(session.user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return shareBoardErrorResponse(error);
    }
    throw error;
  }
}
