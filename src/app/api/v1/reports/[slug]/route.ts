import { authenticateApiToken } from "@/features/account/api-tokens";
import { clientIp } from "@/infrastructure/security/client-ip";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { getReportBySlug } from "@/features/reports/data/reports-db";
import { metaFromForm, validateReportMeta } from "@/features/reports/upload/validate-report-meta";
import { replaceReportFile } from "@/features/reports/upload/upload-report";
import { updateReportMeta } from "@/features/reports/upload/update-report-meta";
import { readUploadForm } from "@/features/reports/upload/upload-request";
import { uploadFailureResponse } from "@/features/reports/upload/upload-errors";

// ── 开放 API：替换/更新已上传的报告 ──
// 认证与限速同 POST /api/v1/reports
// 请求：multipart 表单；file 可选（不传只改元信息）
// 响应：{ ok: true }；错误 { error } + 状态码

const REQ_LIMIT = 30;
const REQ_WINDOW_MS = 60 * 1000;

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const ip = clientIp(req.headers);
  const user = await authenticateApiToken(
    req.headers.get("authorization"),
    ip,
  );
  if (!user) {
    return Response.json(
      { error: "无效的 API 令牌（在账号设置页创建或检查）" },
      { status: 401 },
    );
  }
  const throughput = await consumeSharedRateLimit(
    "api-v1",
    user.id,
    REQ_LIMIT,
    REQ_WINDOW_MS / 1000,
  );
  if (!throughput.allowed) {
    return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const { slug } = await ctx.params;
  const report = await getReportBySlug(user.id, slug);
  if (!report) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const parsed = await readUploadForm(req);
  if (!parsed.ok) return uploadFailureResponse(parsed);
  const { form, file, cleanup } = parsed.value;
  try {
    const meta = metaFromForm(form);
    const metaInvalid = validateReportMeta(meta);
    if (metaInvalid) {
      return uploadFailureResponse(metaInvalid);
    }

    if (file) {
      const result = await replaceReportFile(user.id, slug, file, meta);
      if (!result.ok) {
        return uploadFailureResponse(result);
      }
      return Response.json({ ok: true });
    }

    const result = await updateReportMeta(user.id, slug, meta);
    if (!result.ok) {
      return uploadFailureResponse(result);
    }
    return Response.json({ ok: true });
  } finally {
    await cleanup();
  }
}
