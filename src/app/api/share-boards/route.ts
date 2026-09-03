import { getApiSession } from "@/features/auth/api-session";
import { isGuestEmail } from "@/features/auth/guest/guest-sandbox";
import { createShareBoard, listShareBoards, MAX_BOARD_TITLE_LENGTH, normalizeBoardTitle, parseBoardExpiry } from "@/features/sharing/share-board";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/features/sharing/share-board-errors";
import {
  generateSharePasscode,
  hashSharePassword,
  isValidSharePasscode,
} from "@/features/sharing/report-share";
import { encryptSharePasscode } from "@/features/sharing/share-credentials";

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
    return Response.json({ error: "游客模式不支持分享" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const title = normalizeBoardTitle(body.title);
  if (!title) {
    return Response.json(
      { error: `面板名称不能为空，且最多 ${MAX_BOARD_TITLE_LENGTH} 个字符` },
      { status: 400 },
    );
  }
  const requestedPasscode =
    typeof body.password === "string" && body.password.trim()
      ? body.password.trim().toUpperCase()
      : null;
  if (requestedPasscode && !isValidSharePasscode(requestedPasscode)) {
    return Response.json({ error: "提取码必须是 4 位字母或数字" }, { status: 400 });
  }
  const passcode =
    requestedPasscode ?? (body.passwordProtected === true ? generateSharePasscode() : null);
  const expiresAt = parseBoardExpiry(body.expiresOn);
  if (expiresAt === "invalid") {
    return Response.json({ error: "请选择未来的有效期" }, { status: 400 });
  }
  const reportSlug = typeof body.reportSlug === "string" ? body.reportSlug : undefined;
  const passwordHash = passcode ? await hashSharePassword(passcode) : null;
  const passwordEnc = passcode ? encryptSharePasscode(passcode) : null;
  try {
    const board = await createShareBoard(
      session.user.id,
      title,
      passwordHash,
      passwordEnc,
      expiresAt,
      reportSlug,
    );
    return Response.json({ ok: true, board });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return shareBoardErrorResponse(error);
    }
    throw error;
  }
}
