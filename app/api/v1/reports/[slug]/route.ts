import { authenticateApiToken } from "@/lib/api-tokens";
import { clientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { getReportBySlug } from "@/lib/reports-db";
import {
  metaFromForm,
  replaceReportFile,
  updateReportMeta,
  validateReportMeta,
} from "@/lib/report-upload";

export const dynamic = "force-dynamic";

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
  if (!rateLimit(`api-v1:${clientIp(req.headers)}`, REQ_LIMIT, REQ_WINDOW_MS)) {
    return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const user = await authenticateApiToken(
    req.headers.get("authorization"),
    clientIp(req.headers),
  );
  if (!user) {
    return Response.json(
      { error: "无效的 API 令牌（在账号设置页创建或检查）" },
      { status: 401 },
    );
  }

  const { slug } = await ctx.params;
  const report = await getReportBySlug(user.id, slug);
  if (!report) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "请求体必须是 multipart 表单" }, { status: 400 });
  }

  const meta = metaFromForm(form);
  const metaInvalid = validateReportMeta(meta);
  if (metaInvalid) {
    return Response.json({ error: metaInvalid }, { status: 400 });
  }

  const file = form.get("file");
  if (file && typeof file !== "string") {
    const result = await replaceReportFile(user.id, slug, {
      name: file.name,
      type: file.type,
      buf: Buffer.from(await file.arrayBuffer()),
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
  }

  const result = await updateReportMeta(user.id, slug, meta);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
}
