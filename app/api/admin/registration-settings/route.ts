import { NextResponse } from "next/server";
import { getAdminApiSession } from "@/lib/admin";
import {
  getRegistrationPolicy,
  updateRegistrationPolicy,
} from "@/lib/registration-policy";
import { logSecurity } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAdminApiSession())) {
    return NextResponse.json({ error: "无权访问管理员后台" }, { status: 403 });
  }
  return NextResponse.json(await getRegistrationPolicy(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(req: Request) {
  const session = await getAdminApiSession();
  if (!session) {
    return NextResponse.json({ error: "无权访问管理员后台" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    enabled?: unknown;
    inviteRequired?: unknown;
  } | null;
  if (
    typeof body?.enabled !== "boolean" ||
    typeof body.inviteRequired !== "boolean"
  ) {
    return NextResponse.json({ error: "注册策略参数不正确" }, { status: 400 });
  }
  const policy = await updateRegistrationPolicy({
    enabled: body.enabled,
    inviteRequired: body.inviteRequired,
    updatedBy: session.user.id,
  });
  await logSecurity({
    userId: session.user.id,
    action: "ADMIN_REGISTRATION_POLICY_UPDATED",
  });
  return NextResponse.json(policy, {
    headers: { "Cache-Control": "no-store" },
  });
}
