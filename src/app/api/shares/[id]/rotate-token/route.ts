import { getApiSession } from "@/features/session/api-session";
import { rotateReportShareToken } from "@/features/sharing/rotate-report-share";
import { ReportShareError, reportShareErrorResponse } from "@/features/sharing/report-share-errors";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  try {
    const token = await rotateReportShareToken(session.user.id, (await params).id);
    return Response.json({ ok: true, token });
  } catch (error) {
    if (error instanceof ReportShareError) return reportShareErrorResponse(error);
    throw error;
  }
}
