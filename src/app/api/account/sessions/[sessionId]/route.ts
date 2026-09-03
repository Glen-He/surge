import { getApiSession } from "@/features/auth/api-session";
import { revokeOwnedAccountSession } from "@/features/account/account-sessions";
import { isGuestEmail } from "@/features/auth/guest/guest-sandbox";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/account/sessions/[sessionId]">,
) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  if (isGuestEmail(session.user.email)) {
    return Response.json(
      { error: "游客会话不支持设备管理" },
      { status: 403 },
    );
  }

  const { sessionId } = await context.params;
  const result = await revokeOwnedAccountSession({
    userId: session.user.id,
    currentSessionId: session.session.id,
    targetSessionId: sessionId,
  });

  if (result === "current") {
    return Response.json(
      { error: "请使用当前设备的退出登录入口" },
      { status: 409 },
    );
  }
  if (result === "not-found") {
    return Response.json({ error: "该登录会话已失效" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
