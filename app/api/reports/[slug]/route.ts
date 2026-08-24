import { promises as fs } from "fs";
import path from "path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getReportBySlug } from "@/lib/reports-db";
import { unzipStream, UnzipLimitError } from "@/lib/zip";
import { dirSizeBytes } from "@/lib/guest-sandbox";
import { LIMITS, charWeight } from "@/lib/char-limit";
import { DEFAULT_TAG_COLOR, isTagColor } from "@/lib/tag-colors";
import {
  MAX_ZIP_BYTES,
  MAX_USER_TOTAL_BYTES,
  SITE_TOTAL_CAP_BYTES,
  SITE_TOTAL_WARN_BYTES,
} from "@/lib/storage-limits";

export const dynamic = "force-dynamic";

const USERS_DIR = path.join(process.cwd(), "reports", "users");

// 更新项目信息；FormData 可选携带 file（新 ZIP），不传则保留原报告文件
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
  const title = String(form.get("title") ?? "").trim();
  const date = String(form.get("date") ?? "").trim();
  const tag = String(form.get("tag") ?? "").trim();
  // 标签颜色：仅接受 7 色板内的合法值，否则回退默认色
  const tagColorRaw = String(form.get("tagColor") ?? "").trim();
  const tagColor = isTagColor(tagColorRaw) ? tagColorRaw : DEFAULT_TAG_COLOR;
  const description = String(form.get("description") ?? "").trim();
  const keywords = String(form.get("keywords") ?? "").trim();
  const file = form.get("file");

  if (!title || !date) {
    return Response.json({ error: "标题和日期必填" }, { status: 400 });
  }
  if (tag.length > LIMITS.tag) {
    return Response.json({ error: `标签最长 ${LIMITS.tag} 字` }, { status: 400 });
  }
  if (charWeight(title) > LIMITS.title) {
    return Response.json({ error: `名称最长 ${LIMITS.title} 字` }, { status: 400 });
  }
  if (charWeight(keywords) > LIMITS.keywords) {
    return Response.json({ error: `关键词最长 ${LIMITS.keywords} 字` }, { status: 400 });
  }
  if (charWeight(description) > LIMITS.description) {
    return Response.json({ error: `简介最长 ${LIMITS.description} 字` }, { status: 400 });
  }

  // 可选更换报告文件：先解压到 .tmp 并校验，再原子替换原目录
  if (file && typeof file !== "string") {
    const userDir = path.join(USERS_DIR, session.user.id);
    const dir = path.join(userDir, slug);
    const tmp = path.join(userDir, `${slug}.tmp`);
    const old = path.join(userDir, `${slug}.old`);

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > MAX_ZIP_BYTES) {
      return Response.json({ error: "文件超过 5MB 上限" }, { status: 400 });
    }
    // 单 HTML 上传：文件名/类型识别（与前端 fileKind 同规则）
    const isHtmlFile =
      /\.(html?|xhtml)$/i.test(file.name) || file.type === "text/html";

    // 全站总量检查：≥10GB 暂停上传；≥8GB 后台预警
    const siteTotal = await dirSizeBytes(USERS_DIR);
    if (siteTotal >= SITE_TOTAL_CAP_BYTES) {
      return Response.json(
        { error: "服务器存储已达上限，上传暂停，请联系管理员" },
        { status: 503 },
      );
    }
    if (siteTotal >= SITE_TOTAL_WARN_BYTES) {
      console.warn(
        `[storage] 全站占用 ${(siteTotal / 1024 ** 3).toFixed(2)}GB，已达 8GB 预警线（上限 10GB）`,
      );
    }

    // 清理上次失败可能残留的 tmp（避免污染配额计算），再统计已用容量
    await fs.rm(tmp, { recursive: true, force: true });

    // 配额预检基数：替换场景下原目录随后会被移除，不计入已用
    const usedBefore = await dirSizeBytes(userDir);
    const oldSize = await dirSizeBytes(dir);

    await fs.mkdir(tmp, { recursive: true });

    try {
      if (isHtmlFile) {
        // 单文件上传：HTML 本身就是入口，直接写入 report.html
        await fs.writeFile(path.join(tmp, "report.html"), buf);
        if (usedBefore - oldSize + buf.byteLength > MAX_USER_TOTAL_BYTES) {
          throw new UnzipLimitError(
            `个人存储上限 ${Math.round(MAX_USER_TOTAL_BYTES / (1024 * 1024))}MB，请先删除一些报告再上传`,
          );
        }
      } else {
        const result = await unzipStream(buf, tmp);
        if (
          usedBefore - oldSize + result.totalBytes >
          MAX_USER_TOTAL_BYTES
        ) {
          throw new UnzipLimitError(
            `个人存储上限 ${Math.round(MAX_USER_TOTAL_BYTES / (1024 * 1024))}MB，请先删除一些报告再上传`,
          );
        }
        await fs.access(path.join(tmp, "report.html"));
      }
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true });
      if (err instanceof UnzipLimitError) {
        return Response.json({ error: err.message }, { status: 403 });
      }
      return Response.json(
        { error: "文件无效或缺少 report.html（入口文件）" },
        { status: 400 },
      );
    }

    try {
      await fs.rm(old, { recursive: true, force: true });
      await fs.rename(dir, old);
      await fs.rename(tmp, dir);
      await fs.rm(old, { recursive: true, force: true });
    } catch {
      // 替换失败时尽力恢复原目录
      try {
        await fs.rm(dir, { recursive: true, force: true });
        await fs.rename(old, dir);
      } catch {
        // 原目录恢复失败时保留 tmp 供排查
      }
      await fs.rm(tmp, { recursive: true, force: true });
      return Response.json({ error: "替换报告文件失败，请重试" }, { status: 500 });
    }
  }

  try {
    await db.query(
      `UPDATE reports
       SET title = $1, date = $2, tag = $3, tag_color = $4, description = $5, keywords = $6
       WHERE user_id = $7 AND slug = $8`,
      [title, date, tag, tagColor, description, keywords, session.user.id, slug],
    );
  } catch {
    return Response.json({ error: "保存失败，请重试" }, { status: 500 });
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
