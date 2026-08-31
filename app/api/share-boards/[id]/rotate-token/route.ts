import { getApiSession } from "@/lib/api-session";
import { rotateShareBoardToken } from "@/lib/share-boards";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/lib/share-board-errors";

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
