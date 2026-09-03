import { getApiSession } from "@/features/auth/api-session";
import { rotateShareBoardToken } from "@/features/sharing/share-board";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/features/sharing/share-board-errors";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  try {
    const token = await rotateShareBoardToken(session.user.id, id);
    return Response.json({ ok: true, token });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return shareBoardErrorResponse(error);
    }
    throw error;
  }
}
