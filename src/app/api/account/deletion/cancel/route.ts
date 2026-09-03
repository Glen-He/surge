import { getApiSession } from "@/features/auth/api-session";
import { cancelDeletion } from "@/features/account/account-deletion";
import { logSecurity } from "@/features/account/security-log";

export const dynamic = "force-dynamic";

// 冷却期内取消删除申请
export async function POST() {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  if (!(await cancelDeletion(session.user.id))) {
    return Response.json(
      { error: "删除申请不存在或账号已发生变化" },
      { status: 409 },
    );
  }
  await logSecurity({
    userId: session.user.id,
    email: session.user.email,
    action: "deletion_cancelled",
  });
  return Response.json({ ok: true });
}
