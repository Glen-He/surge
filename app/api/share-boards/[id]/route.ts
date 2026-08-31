import { getApiSession } from "@/lib/api-session";
import {
  deleteShareBoard,
  MAX_BOARD_TITLE_LENGTH,
  normalizeBoardTitle,
  parseBoardExpiry,
  updateShareBoard,
} from "@/lib/share-boards";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/lib/share-board-errors";
import {
  generateSharePasscode,
  hashSharePassword,
  isValidSharePasscode,
} from "@/lib/shares";
import { encryptSharePasscode } from "@/lib/share-token-store";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const changes: {
    title?: string;
    passwordHash?: string | null;
    passwordEnc?: string | null;
    disabled?: boolean;
    expiresAt?: Date | null;
  } = {};
  if (body.title !== undefined) {
    const title = normalizeBoardTitle(body.title);
    if (!title) {
      return Response.json(
        { error: `面板名称不能为空，且最多 ${MAX_BOARD_TITLE_LENGTH} 个字符` },
        { status: 400 },
      );
    }
    changes.title = title;
  }
  let passcode: string | null | undefined;
  if (body.regeneratePassword === true) {
    passcode = generateSharePasscode();
    changes.passwordHash = await hashSharePassword(passcode);
    changes.passwordEnc = encryptSharePasscode(passcode);
  } else if (body.password !== undefined) {
    if (body.password === null || body.password === "") {
      changes.passwordHash = null;
      changes.passwordEnc = null;
      passcode = null;
    } else if (typeof body.password === "string") {
      const password = body.password.trim().toUpperCase();
      if (!isValidSharePasscode(password)) {
        return Response.json({ error: "提取码必须是 4 位字母或数字" }, { status: 400 });
      }
      changes.passwordHash = await hashSharePassword(password);
      changes.passwordEnc = encryptSharePasscode(password);
      passcode = password;
    } else {
      return Response.json({ error: "无效的密码设置" }, { status: 400 });
    }
  }
  if (body.expiresOn !== undefined) {
    const expiresAt = parseBoardExpiry(body.expiresOn);
    if (expiresAt === "invalid") {
      return Response.json({ error: "请选择未来的有效期" }, { status: 400 });
    }
    changes.expiresAt = expiresAt;
  }
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== "boolean") {
      return Response.json({ error: "无效的启停设置" }, { status: 400 });
    }
    changes.disabled = body.disabled;
  }
  if (Object.keys(changes).length === 0) {
    return Response.json({ error: "没有可更新的内容" }, { status: 400 });
  }
  try {
    await updateShareBoard(session.user.id, id, changes);
    return Response.json({ ok: true, passcode });
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
