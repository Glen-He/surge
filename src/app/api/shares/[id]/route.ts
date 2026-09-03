import { getApiSession } from "@/features/session/api-session";
import { revokeReportShare } from "@/features/sharing/report-share";
import {
  ReportShareError,
  reportShareErrorResponse,
} from "@/features/sharing/report-share-errors";

export const dynamic = "force-dynamic";

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
