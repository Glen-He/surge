import { getApiSession } from "@/features/session/api-session";
import { isGuestEmail } from "@/features/auth/guest/guest-identity";
import { boardExpiryFromDays, createShareBoard, listShareBoards, MAX_BOARD_TITLE_LENGTH, normalizeBoardTitle } from "@/features/sharing/share-board";
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
  const reportSlug = typeof body.reportSlug === "string" ? body.reportSlug : undefined;
  const passwordHash = passcode ? await hashSharePassword(passcode) : null;
  const passwordEnc = passcode ? encryptSharePasscode(passcode) : null;
  try {
    // 未传档位时按「永久有效」处理（0 天）；非法档位抛 BOARD_EXPIRY_INVALID。
    const expiresAt = boardExpiryFromDays(body.expiresInDays ?? 0);
    const board = await createShareBoard(
      session.user.id,
      title,
      passwordHash,
      passwordEnc,
      expiresAt,
      reportSlug,
      body.disabled === true,
    );
    return Response.json({ ok: true, board });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return shareBoardErrorResponse(error);
    }
    throw error;
  }
}
