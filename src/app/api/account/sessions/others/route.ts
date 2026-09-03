import { getApiSession } from "@/features/auth/api-session";
import { revokeOtherAccountSessions } from "@/features/account/account-sessions";
import { isGuestEmail } from "@/features/auth/guest/guest-sandbox";

export async function DELETE() {
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

  const revoked = await revokeOtherAccountSessions(
    session.user.id,
    session.session.id,
  );
  return Response.json({ ok: true, revoked });
}
