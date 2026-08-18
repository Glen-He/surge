import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { cancelDeletion } from "@/lib/account-deletion";
import { logSecurity } from "@/lib/account";

export const dynamic = "force-dynamic";

// 冷却期内取消删除申请
export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  await cancelDeletion(session.user.id);
  await logSecurity({
    userId: session.user.id,
    email: session.user.email,
    action: "deletion_cancelled",
  });
  return Response.json({ ok: true });
}
