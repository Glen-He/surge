import { getApiSession } from "@/lib/api-session";
import { isGuestEmail } from "@/lib/guest-sandbox";
import {
  createShareBoard,
  listShareBoards,
  MAX_BOARD_TITLE_LENGTH,
  normalizeBoardTitle,
  ShareBoardError,
} from "@/lib/share-boards";
import { hashSharePassword } from "@/lib/shares";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const boards = await listShareBoards(session.user.id);
  return Response.json({ boards });
}

export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  if (isGuestEmail(session.user.email)) {
    return Response.json({ error: "访客模式不支持分享" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const title = normalizeBoardTitle(body.title);
  if (!title) {
    return Response.json(
      { error: `面板名称不能为空，且最多 ${MAX_BOARD_TITLE_LENGTH} 个字符` },
      { status: 400 },
    );
  }
  const password =
    typeof body.password === "string" && body.password.trim()
      ? body.password.trim()
      : null;
  if (password && (password.length < 4 || password.length > 64)) {
    return Response.json({ error: "密码长度需在 4 ~ 64 位之间" }, { status: 400 });
  }
  const reportSlug = typeof body.reportSlug === "string" ? body.reportSlug : undefined;
  const passwordHash = password ? await hashSharePassword(password) : null;
  try {
    const board = await createShareBoard(
      session.user.id,
      title,
      passwordHash,
      reportSlug,
    );
    return Response.json({ ok: true, board });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
