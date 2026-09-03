import { getApiSession } from "@/features/session/api-session";
import { isGuestEmail } from "@/features/auth/guest/guest-identity";
import {
  createReportShare,
  listSharesBySlug,
} from "@/features/sharing/report-share";
import {
  ReportShareError,
  reportShareErrorResponse,
} from "@/features/sharing/report-share-errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const { slug } = await params;
  const shares = await listSharesBySlug(session.user.id, slug);
  return Response.json({
    shares: shares.map((share) => ({
      id: share.id,
      token: share.token,
      hasPassword: share.password_hash !== null,
      passcode: share.passcode,
      expiresAt: share.expires_at,
      viewCount: Number(share.view_count),
      createdAt: share.created_at,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  if (isGuestEmail(session.user.email)) {
    return Response.json({ error: "游客模式不支持分享" }, { status: 403 });
  }

  const { slug } = await params;
  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
    passwordProtected?: unknown;
    expiresInDays?: unknown;
  } | null;
  try {
    const share = await createReportShare({
      userId: session.user.id,
      slug,
      requestedPasscode: body?.password,
      passwordProtected: body?.passwordProtected === true,
      expiresInDays: body?.expiresInDays,
    });
    return Response.json({ ok: true, share });
  } catch (error) {
    if (error instanceof ReportShareError) {
      return reportShareErrorResponse(error);
    }
    throw error;
  }
}
