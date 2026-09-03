import { getApiSession } from "@/features/session/api-session";
import { clientIp } from "@/infrastructure/security/client-ip";
import {
  AccountInvitationError,
  INVITATION_UNREADABLE_COPY,
  accountInvitationErrorResponse,
} from "@/features/account/invitation-errors";
import {
  getAccountInvitation,
  mutateAccountInvitation,
} from "@/features/account/manage-invitation";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  try {
    const invite = await getAccountInvitation({
      userId: session.user.id,
      email: session.user.email,
    });
    return Response.json(
      {
        invite,
        error: invite && !invite.code ? INVITATION_UNREADABLE_COPY : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AccountInvitationError) {
      return accountInvitationErrorResponse(error);
    }
    throw error;
  }
}

async function mutate(request: Request, mutation: "create" | "rotate" | "revoke") {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  try {
    const result = await mutateAccountInvitation({
      userId: session.user.id,
      email: session.user.email,
      clientIp: clientIp(request.headers),
      mutation,
    });
    return Response.json(result, {
      status: mutation === "create" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AccountInvitationError) {
      return accountInvitationErrorResponse(error);
    }
    throw error;
  }
}

export function POST(request: Request) {
  return mutate(request, "create");
}

export function PATCH(request: Request) {
  return mutate(request, "rotate");
}

export function DELETE(request: Request) {
  return mutate(request, "revoke");
}
