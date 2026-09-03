import { getApiSession } from "@/features/session/api-session";
import { getReportBySlug } from "@/features/reports/data/reports-db";
import { deleteReport } from "@/features/reports/upload/delete-report";
import { metaFromForm, validateReportMeta } from "@/features/reports/upload/validate-report-meta";
import { replaceReportFile } from "@/features/reports/upload/upload-report";
import { updateReportMeta } from "@/features/reports/upload/update-report-meta";
import { readUploadForm } from "@/features/reports/upload/upload-request";
import { uploadFailureResponse } from "@/features/reports/upload/upload-errors";

export const dynamic = "force-dynamic";

// 更新项目信息；FormData 可选携带 file（新 ZIP），不传则保留原报告文件
// 业务实现（校验/配额/锁/原子替换）在 features/reports/upload/，与开放 API 共用
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { slug } = await ctx.params;
  const report = await getReportBySlug(session.user.id, slug);
  if (!report) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const parsed = await readUploadForm(req);
  if (!parsed.ok) return uploadFailureResponse(parsed);
  const { form, file, cleanup } = parsed.value;
  try {
    const meta = metaFromForm(form);

    // 先校验元信息，再动文件：避免字段不合法却已把报告文件换掉
    const metaInvalid = validateReportMeta(meta);
    if (metaInvalid) {
      return uploadFailureResponse(metaInvalid);
    }

    if (file) {
      const result = await replaceReportFile(session.user.id, slug, file, meta);
      if (!result.ok) {
        return uploadFailureResponse(result);
      }
      return Response.json({ ok: true });
    }

    const result = await updateReportMeta(session.user.id, slug, meta);
    if (!result.ok) {
      return uploadFailureResponse(result);
    }
    return Response.json({ ok: true });
  } finally {
    await cleanup();
  }
}

// 删除项目：DB 行（report_shares 随 FK 级联删除）+ 磁盘目录（含替换残留的 .tmp/.old）
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { slug } = await ctx.params;
  const report = await getReportBySlug(session.user.id, slug);
  if (!report) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const result = await deleteReport(session.user.id, slug);
  if (!result.ok) {
    return uploadFailureResponse(result);
  }
  return Response.json({ ok: true });
}
