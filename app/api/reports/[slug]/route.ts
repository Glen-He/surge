import { promises as fs } from "fs";
import path from "path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getReportBySlug } from "@/lib/reports-db";
import {
  metaFromForm,
  replaceReportFile,
  updateReportMeta,
  validateReportMeta,
  USERS_DIR,
} from "@/lib/report-upload";

export const dynamic = "force-dynamic";

// 更新项目信息；FormData 可选携带 file（新 ZIP），不传则保留原报告文件
// 业务实现（校验/配额/锁/原子替换）在 lib/report-upload.ts，与开放 API 共用
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { slug } = await ctx.params;
  const report = await getReportBySlug(session.user.id, slug);
  if (!report) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const form = await req.formData();
  const meta = metaFromForm(form);
  const file = form.get("file");

  // 先校验元信息，再动文件：避免字段不合法却已把报告文件换掉
  const metaInvalid = validateReportMeta(meta);
  if (metaInvalid) {
    return Response.json({ error: metaInvalid }, { status: 400 });
  }

  // 可选更换报告文件：先解压到 .tmp 并校验，再原子替换原目录
  if (file && typeof file !== "string") {
    const result = await replaceReportFile(session.user.id, slug, {
      name: file.name,
      type: file.type,
      buf: Buffer.from(await file.arrayBuffer()),
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
  }

  const result = await updateReportMeta(session.user.id, slug, meta);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
}

// 删除项目：DB 行（report_shares 随 FK 级联删除）+ 磁盘目录（含替换残留的 .tmp/.old）
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { slug } = await ctx.params;
  const report = await getReportBySlug(session.user.id, slug);
  if (!report) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const userDir = path.join(USERS_DIR, session.user.id);
  try {
    await db.query(`DELETE FROM reports WHERE user_id = $1 AND slug = $2`, [
      session.user.id,
      slug,
    ]);
    await fs.rm(path.join(userDir, slug), { recursive: true, force: true });
    await fs.rm(path.join(userDir, `${slug}.tmp`), { recursive: true, force: true });
    await fs.rm(path.join(userDir, `${slug}.old`), { recursive: true, force: true });
  } catch {
    return Response.json({ error: "删除失败，请重试" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
