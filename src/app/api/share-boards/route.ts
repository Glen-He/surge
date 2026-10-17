import { getApiSession } from "@/features/session/api-session";
import { isGuestEmail } from "@/features/auth/guest/guest-identity";
import {
  createOwnerShareBoard,
  listShareBoards,
} from "@/features/sharing/share-board";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/features/sharing/share-board-errors";

export async function GET() {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const boards = await listShareBoards(session.user.id);
  return Response.json(
    { boards },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  if (isGuestEmail(session.user.email)) {
    return Response.json({ error: "游客模式不支持分享" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const board = await createOwnerShareBoard({
      userId: session.user.id,
      title: body.title,
      password: body.password,
      passwordProtected: body.passwordProtected,
      reportSlug: body.reportSlug,
      expiresInDays: body.expiresInDays,
      disabled: body.disabled,
    });
    return Response.json({ ok: true, board });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return shareBoardErrorResponse(error);
    }
    throw error;
  }
}
