import { getApiSession } from "@/features/session/api-session";
import { clientIp } from "@/infrastructure/security/client-ip";
import { getApiToken } from "@/features/account/api-tokens";
import {
  API_TOKEN_UNREADABLE_COPY,
  ApiTokenManagementError,
  apiTokenErrorResponse,
} from "@/features/account/api-token-errors";
import { mutateApiToken } from "@/features/account/manage-api-token";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const result = await getApiToken(session.user.id);
  return Response.json(
    {
      token: result,
      error: result && !result.token ? API_TOKEN_UNREADABLE_COPY : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function mutate(
  request: Request,
  mutation: "create" | "rotate" | "revoke",
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  try {
    const token = await mutateApiToken({
      userId: session.user.id,
      email: session.user.email,
      clientIp: clientIp(request.headers),
      mutation,
    });
    if (mutation === "revoke") return Response.json({ ok: true });
    return Response.json(
      { token },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ApiTokenManagementError) {
      return apiTokenErrorResponse(error);
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
