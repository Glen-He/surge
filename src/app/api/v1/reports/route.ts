import { authenticateApiToken } from "@/features/account/api-tokens";
import { clientIp } from "@/infrastructure/security/client-ip";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { createReport } from "@/features/reports/upload/upload-report";
import { metaFromForm } from "@/features/reports/upload/validate-report-meta";
import { readUploadForm } from "@/features/reports/upload/upload-request";
import { uploadFailureResponse } from "@/features/reports/upload/upload-errors";

export const dynamic = "force-dynamic";

// ── 开放 API：程序化上传 ──
// 认证：Authorization: Bearer sgk_xxx（账号设置页创建）
// 请求：multipart 表单，字段与网页上传一致
//   title*(≤20字) date*(YYYY-MM-DD) tag(≤6字) tagColor(色板值)
//   description(≤200字) keywords(≤50字) file*(HTML 或 zip，≤50MB)
// 响应：{ ok: true, slug }；错误 { error } + 状态码
//
// 上传业务与网页端共用 lib/report-upload.ts（同一套校验/配额/锁）

// 令牌请求全局限速：同 IP 30 次 / 分钟（认证失败另有更严的 20 次/10 分钟）
const REQ_LIMIT = 30;
const REQ_WINDOW_MS = 60 * 1000;

export async function POST(req: Request) {
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

  const parsed = await readUploadForm(req);
  if (!parsed.ok) return uploadFailureResponse(parsed);
  const { form, file, cleanup } = parsed.value;
  try {
    if (!file) {
      return Response.json({ error: "缺少 file 字段（HTML 或 zip）" }, { status: 400 });
    }
    const result = await createReport(user.id, user.email, metaFromForm(form), file);
    if (!result.ok) {
      return uploadFailureResponse(result);
    }
    return Response.json({ ok: true, slug: result.slug });
  } finally {
    await cleanup();
  }
}
