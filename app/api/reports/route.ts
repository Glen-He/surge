import { getApiSession } from "@/lib/api-session";
import {
  createReport,
  metaFromForm,
} from "@/lib/report-upload";
import { readUploadForm } from "@/lib/upload-request";
import { uploadFailureResponse } from "@/lib/upload-errors";

export const dynamic = "force-dynamic";

// 上传新报告：multipart 表单（title/date/tag/description/keywords/file[zip]）
// 业务实现（校验/配额/锁/转正）在 lib/report-upload.ts，与开放 API 共用
export async function POST(req: Request) {
  const session = await getApiSession();
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = await readUploadForm(req);
  if (!parsed.ok) return uploadFailureResponse(parsed);
  const { form, file, cleanup } = parsed.value;
  try {
    if (!file) {
      return Response.json({ error: "请上传 ZIP 压缩包或 HTML 文件" }, { status: 400 });
    }
    const result = await createReport(
      session.user.id,
      session.user.email,
      metaFromForm(form),
      file,
    );
    if (!result.ok) {
      return uploadFailureResponse(result);
    }
    return Response.json({ ok: true, slug: result.slug });
  } finally {
    await cleanup();
  }
}
