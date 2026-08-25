import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db, withUserStorageLock } from "@/lib/db";
import { unzipStream, UnzipLimitError } from "@/lib/zip";
import { dirSizeBytes, isGuestEmail } from "@/lib/guest-sandbox";
import { logger } from "@/lib/logger";
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

// 上传新报告：multipart 表单（title/date/tag/description/keywords/file[zip]）
export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
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
  if (!file || typeof file === "string") {
    return Response.json({ error: "请上传 ZIP 压缩包或 HTML 文件" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_ZIP_BYTES) {
    return Response.json({ error: "文件超过 5MB 上限" }, { status: 400 });
  }
  // 单 HTML 上传：文件名/类型识别（与前端 fileKind 同规则）
  const isHtmlFile =
    /\.(html?|xhtml)$/i.test(file.name) || file.type === "text/html";

  // 访客限传：沙箱内最多保留 1 个自己上传的项目（示例报告是 demo_ 前缀不计入）
  if (isGuestEmail(session.user.email)) {
    const own = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM reports
       WHERE user_id = $1 AND slug LIKE 'r\\_%'`,
      [session.user.id],
    );
    if (Number(own.rows[0]?.n ?? 0) >= 1) {
      return Response.json(
        { error: "访客模式最多上传 1 个项目，删除后可再次上传" },
        { status: 403 },
      );
    }
  }

  const userDir = path.join(USERS_DIR, session.user.id);

  // 配额检查 + 写盘临界区：advisory lock 串行化同一用户的并发上传，
  // 防止并行请求各自读到旧存量而双双超额
  return withUserStorageLock(session.user.id, async () => {
    // 全站总量检查：≥10GB 暂停上传；≥8GB 后台预警
    const siteTotal = await dirSizeBytes(USERS_DIR);
    if (siteTotal >= SITE_TOTAL_CAP_BYTES) {
      return Response.json(
        { error: "服务器存储已达上限，上传暂停，请联系管理员" },
        { status: 503 },
      );
    }
    if (siteTotal >= SITE_TOTAL_WARN_BYTES) {
      logger.warn("storage", "全站占用已达预警线", {
        usedGB: Number((siteTotal / 1024 ** 3).toFixed(2)),
        warnGB: 8,
        capGB: 10,
      });
    }

    // 用户已用容量（新项目目录尚未创建，先算存量）
    const used = await dirSizeBytes(userDir);

    const slug = `r_${randomUUID().slice(0, 8)}`;
    const dir = path.join(userDir, slug);
    // 先解压到随机临时目录，全部校验通过后再转正为正式项目目录；
    // 任何失败（超限/缺入口/写库失败）都立即删除临时目录，不留残骸
    const tmp = path.join(userDir, `${slug}.tmp`);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });

    // 解压（zip）或直接落盘（单 HTML）：50 文件 / 5 层目录 / 累计 10MB 硬顶
    // 全部校验通过后再转正为正式项目目录；任何失败都立即删除临时目录不留残骸
    let projectBytes = 0;
    try {
      if (isHtmlFile) {
        // 单文件上传：HTML 本身就是入口，直接写入 report.html
        await fs.writeFile(path.join(tmp, "report.html"), buf);
        projectBytes = buf.byteLength;
      } else {
        const result = await unzipStream(buf, tmp);
        projectBytes = result.totalBytes;
        // 入口文件校验
        await fs.access(path.join(tmp, "report.html"));
      }

      // 解压后精确配额复查：存量 + 本项目 ≤ 用户总容量
      if (used + projectBytes > MAX_USER_TOTAL_BYTES) {
        throw new UnzipLimitError(
          `个人存储上限 200MB（已用 ${Math.round(used / 1024 / 1024)}MB），请先删除一些报告再上传`,
        );
      }
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true });
      if (err instanceof UnzipLimitError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      return Response.json(
        { error: "文件无效或缺少 report.html（入口文件）" },
        { status: 400 },
      );
    }

    // 校验全部通过：临时目录转正
    try {
      await fs.rename(tmp, dir);
    } catch {
      await fs.rm(tmp, { recursive: true, force: true });
      return Response.json({ error: "保存失败，请重试" }, { status: 500 });
    }

    try {
      const minRow = await db.query<{ m: number }>(
        `SELECT COALESCE(MIN(sort_order), 0) AS m FROM reports WHERE user_id = $1`,
        [session.user.id],
      );
      const sortOrder = (minRow.rows[0]?.m ?? 0) - 1;

      await db.query(
        `INSERT INTO reports (id, user_id, slug, title, date, tag, tag_color, description, keywords, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          session.user.id,
          slug,
          title,
          date,
          tag,
          tagColor,
          description,
          keywords,
          sortOrder,
        ],
      );
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true });
      return Response.json(
        { error: "保存失败，请重试" },
        { status: 500 },
      );
    }

    return Response.json({ ok: true, slug });
  });
}
