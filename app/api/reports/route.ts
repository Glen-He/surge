import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  createReport,
  metaFromForm,
} from "@/lib/report-upload";

export const dynamic = "force-dynamic";

// 上传新报告：multipart 表单（title/date/tag/description/keywords/file[zip]）
// 业务实现（校验/配额/锁/转正）在 lib/report-upload.ts，与开放 API 共用
export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ error: "请上传 ZIP 压缩包或 HTML 文件" }, { status: 400 });
  }

  const result = await createReport(
    session.user.id,
    session.user.email,
    metaFromForm(form),
    { name: file.name, type: file.type, buf: Buffer.from(await file.arrayBuffer()) },
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, slug: result.slug });
}
