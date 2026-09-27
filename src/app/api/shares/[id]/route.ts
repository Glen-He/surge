import { getApiSession } from "@/features/session/api-session";
import {
  revokeReportShare,
  updateReportShareSettings,
} from "@/features/sharing/report-share";
import {
  ReportShareError,
  reportShareErrorResponse,
} from "@/features/sharing/report-share-errors";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await updateReportShareSettings({
      userId: session.user.id,
      shareId: id,
      expiresInDays: body.expiresInDays,
      password: body.password,
      regeneratePassword: body.regeneratePassword,
      disabled: body.disabled,
    });
    return Response.json({ ok: true, passcode: result.passcode });
  } catch (error) {
    if (error instanceof ReportShareError) {
      return reportShareErrorResponse(error);
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  try {
    await revokeReportShare(session.user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ReportShareError) {
      return reportShareErrorResponse(error);
    }
    throw error;
  }
}
