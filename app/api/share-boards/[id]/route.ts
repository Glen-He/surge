import { getApiSession } from "@/lib/api-session";
import {
  deleteShareBoard,
  MAX_BOARD_TITLE_LENGTH,
  normalizeBoardTitle,
  ShareBoardError,
  updateShareBoard,
} from "@/lib/share-boards";
import { hashSharePassword } from "@/lib/shares";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const changes: { title?: string; passwordHash?: string | null; disabled?: boolean } = {};
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
  if (body.password !== undefined) {
    if (body.password === null || body.password === "") {
      changes.passwordHash = null;
    } else if (typeof body.password === "string") {
      const password = body.password.trim();
      if (password.length < 4 || password.length > 64) {
        return Response.json({ error: "密码长度需在 4 ~ 64 位之间" }, { status: 400 });
      }
      changes.passwordHash = await hashSharePassword(password);
    } else {
      return Response.json({ error: "无效的密码设置" }, { status: 400 });
    }
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
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ShareBoardError) {
      return Response.json({ error: error.message }, { status: error.status });
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
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
