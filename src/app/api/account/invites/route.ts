import { getApiSession } from "@/features/auth/api-session";
import { logSecurity } from "@/features/account/security-log";
import { clientIp } from "@/infrastructure/security/client-ip";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { isGuestEmail } from "@/features/auth/guest/guest-sandbox";
import { logger } from "@/infrastructure/logging/logger";
import { registrationErrorCopy } from "@/features/auth/registration-errors";
import {
  createRegistrationInvite,
  getRegistrationInvite,
  revokeRegistrationInvite,
  rotateRegistrationInvite,
} from "@/features/auth/registration-invites";

export const dynamic = "force-dynamic";

async function invitationSession() {
  const session = await getApiSession();
  if (!session) {
    return { error: Response.json({ error: "未登录" }, { status: 401 }) } as const;
  }
  if (isGuestEmail(session.user.email)) {
    return {
      error: Response.json(
        { error: "游客模式不支持邀请用户，注册正式账号后可用" },
        { status: 403 },
      ),
    } as const;
  }
  return { session } as const;
}

async function mutationGuard(req: Request, userId: string, action: string) {
  const ip = clientIp(req.headers);
  const rate = await consumeSharedRateLimit(
    "registration-invite-mutate",
    userId,
    30,
    10 * 60,
  );
  if (!rate.allowed) {
    logger.warn("registration-invites", "invite action rate limited", {
      userId,
      action,
      ip,
    });
    return {
      error: Response.json(
        { error: registrationErrorCopy("INVITE_MUTATION_RATE_LIMIT") },
        { status: 429 },
      ),
      ip,
    } as const;
  }
  return { ip } as const;
}

export async function GET() {
  const auth = await invitationSession();
  if ("error" in auth) return auth.error;
  const invite = await getRegistrationInvite(auth.session.user.id);
  return Response.json(
    {
      invite,
      error:
        invite && !invite.code
          ? "邀请码无法显示，请更换后重新生成"
          : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const auth = await invitationSession();
  if ("error" in auth) return auth.error;
  const guard = await mutationGuard(req, auth.session.user.id, "create");
  if ("error" in guard) return guard.error;
  try {
    const result = await createRegistrationInvite(auth.session.user.id);
    if ("errorCode" in result) {
      return Response.json(
        { error: registrationErrorCopy(result.errorCode) },
        { status: 409 },
      );
    }
    await logSecurity({
      userId: auth.session.user.id,
      action: "REGISTRATION_INVITE_CREATED",
      ip: guard.ip,
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logger.error(
      "registration-invites",
      "failed to create registration invite",
      error as Error,
      { userId: auth.session.user.id, ip: guard.ip },
    );
    return Response.json(
      { error: registrationErrorCopy("INVITE_CREATE_FAILED") },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const auth = await invitationSession();
  if ("error" in auth) return auth.error;
  const guard = await mutationGuard(req, auth.session.user.id, "rotate");
  if ("error" in guard) return guard.error;
  try {
    const result = await rotateRegistrationInvite(auth.session.user.id);
    await logSecurity({
      userId: auth.session.user.id,
      action: "REGISTRATION_INVITE_ROTATED",
      ip: guard.ip,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error(
      "registration-invites",
      "failed to rotate registration invite",
      error as Error,
      { userId: auth.session.user.id, ip: guard.ip },
    );
    return Response.json(
      { error: registrationErrorCopy("INVITE_CREATE_FAILED") },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const auth = await invitationSession();
  if ("error" in auth) return auth.error;
  const guard = await mutationGuard(req, auth.session.user.id, "revoke");
  if ("error" in guard) return guard.error;
  if (!(await revokeRegistrationInvite(auth.session.user.id))) {
    return Response.json({ error: "没有可撤销的邀请码" }, { status: 404 });
  }
  await logSecurity({
    userId: auth.session.user.id,
    action: "REGISTRATION_INVITE_REVOKED",
    ip: guard.ip,
  });
  return Response.json({ ok: true });
}
