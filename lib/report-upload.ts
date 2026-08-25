import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { db, withUserStorageLock } from "./db";
import { unzipStream, UnzipLimitError } from "./zip";
import { dirSizeBytes, isGuestEmail } from "./guest-sandbox";
import { logger } from "./logger";
import { LIMITS, charWeight } from "./char-limit";
import { DEFAULT_TAG_COLOR, isTagColor } from "./tag-colors";
import {
  MAX_ZIP_BYTES,
  MAX_USER_TOTAL_BYTES,
  SITE_TOTAL_CAP_BYTES,
  SITE_TOTAL_WARN_BYTES,
} from "./storage-limits";

// ── 报告上传核心 ──
// 网页端（/api/reports*，会话认证）与开放 API（/api/v1/reports*，令牌认证）
// 共用这一份业务实现：字段校验、配额、advisory lock 串行化、
// 临时目录转正/原子替换。任何规则改动只改这里。

export const USERS_DIR = path.join(process.cwd(), "reports", "users");

export type ReportMeta = {
  title: string;
  date: string;
  tag: string;
  tagColor: string;
  description: string;
  keywords: string;
};

export type UploadFile = { name: string; type: string; buf: Buffer };

export type UploadResult =
  | { ok: true; slug: string }
  | { ok: false; error: string; status: number };

/** 字段校验（两套端点同一规则） */
export function validateReportMeta(meta: ReportMeta): string | null {
  if (!meta.title || !meta.date) return "标题和日期必填";
  if (meta.tag.length > LIMITS.tag) return `标签最长 ${LIMITS.tag} 字`;
  if (charWeight(meta.title) > LIMITS.title)
    return `名称最长 ${LIMITS.title} 字`;
  if (charWeight(meta.keywords) > LIMITS.keywords)
    return `关键词最长 ${LIMITS.keywords} 字`;
  if (charWeight(meta.description) > LIMITS.description)
    return `简介最长 ${LIMITS.description} 字`;
  return null;
}

/** 从 FormData 提取并规范化元信息（非法 tagColor 回退默认色） */
export function metaFromForm(form: FormData): ReportMeta {
  const tagColorRaw = String(form.get("tagColor") ?? "").trim();
  return {
    title: String(form.get("title") ?? "").trim(),
    date: String(form.get("date") ?? "").trim(),
    tag: String(form.get("tag") ?? "").trim(),
    tagColor: isTagColor(tagColorRaw) ? tagColorRaw : DEFAULT_TAG_COLOR,
    description: String(form.get("description") ?? "").trim(),
    keywords: String(form.get("keywords") ?? "").trim(),
  };
}

/** 单 HTML 上传识别（文件名/类型，与前端 fileKind 同规则） */
export function isHtmlUpload(file: { name: string; type: string }): boolean {
  return /\.(html?|xhtml)$/i.test(file.name) || file.type === "text/html";
}

function assertFileSize(buf: Buffer): string | null {
  if (buf.byteLength > MAX_ZIP_BYTES) return "文件超过 50MB 上限";
  return null;
}

/** 全站总量闸门：≥10GB 暂停上传；≥8GB 预警（调用方需已持有用户级锁） */
async function checkSiteCap(): Promise<string | null> {
  const siteTotal = await dirSizeBytes(USERS_DIR);
  if (siteTotal >= SITE_TOTAL_CAP_BYTES) {
    return "服务器存储已达上限，上传暂停，请联系管理员";
  }
  if (siteTotal >= SITE_TOTAL_WARN_BYTES) {
    logger.warn("storage", "全站占用已达预警线", {
      usedGB: Number((siteTotal / 1024 ** 3).toFixed(2)),
      warnGB: 8,
      capGB: 10,
    });
  }
  return null;
}

/**
 * 上传新报告：解压/落盘 → 配额 → 转正 → 入库。
 * 任何失败（超限/缺入口/写库失败）都不留磁盘残骸。
 */
export async function createReport(
  userId: string,
  email: string,
  meta: ReportMeta,
  file: UploadFile,
): Promise<UploadResult> {
  const invalid = validateReportMeta(meta);
  if (invalid) return { ok: false, error: invalid, status: 400 };
  const sizeErr = assertFileSize(file.buf);
  if (sizeErr) return { ok: false, error: sizeErr, status: 400 };

  // 访客限传：沙箱内最多保留 1 个自己上传的项目（示例报告 demo_ 前缀不计入）
  if (isGuestEmail(email)) {
    const own = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM reports
       WHERE user_id = $1 AND slug LIKE 'r\\_%'`,
      [userId],
    );
    if (Number(own.rows[0]?.n ?? 0) >= 1) {
      return {
        ok: false,
        error: "访客模式最多上传 1 个项目，删除后可再次上传",
        status: 403,
      };
    }
  }

  const userDir = path.join(USERS_DIR, userId);
  const isHtmlFile = isHtmlUpload(file);

  // 配额检查 + 写盘临界区：advisory lock 串行化同一用户的并发上传
  return withUserStorageLock(userId, async (): Promise<UploadResult> => {
    const capErr = await checkSiteCap();
    if (capErr) return { ok: false, error: capErr, status: 503 };

    const used = await dirSizeBytes(userDir);

    const slug = `r_${randomUUID().slice(0, 8)}`;
    const dir = path.join(userDir, slug);
    // 先解压到随机临时目录，全部校验通过后再转正
    const tmp = path.join(userDir, `${slug}.tmp`);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });

    let projectBytes = 0;
    try {
      if (isHtmlFile) {
        await fs.writeFile(path.join(tmp, "report.html"), file.buf);
        projectBytes = file.buf.byteLength;
      } else {
        const result = await unzipStream(file.buf, tmp);
        projectBytes = result.totalBytes;
        await fs.access(path.join(tmp, "report.html"));
      }
      if (used + projectBytes > MAX_USER_TOTAL_BYTES) {
        throw new UnzipLimitError(
          `个人存储上限 200MB（已用 ${Math.round(used / 1024 / 1024)}MB），请先删除一些报告再上传`,
        );
      }
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true });
      if (err instanceof UnzipLimitError) {
        return { ok: false, error: err.message, status: 400 };
      }
      return {
        ok: false,
        error: "文件无效或缺少 report.html（入口文件）",
        status: 400,
      };
    }

    try {
      await fs.rename(tmp, dir);
    } catch {
      await fs.rm(tmp, { recursive: true, force: true });
      return { ok: false, error: "保存失败，请重试", status: 500 };
    }

    try {
      const minRow = await db.query<{ m: number }>(
        `SELECT COALESCE(MIN(sort_order), 0) AS m FROM reports WHERE user_id = $1`,
        [userId],
      );
      const sortOrder = (minRow.rows[0]?.m ?? 0) - 1;
      await db.query(
        `INSERT INTO reports (id, user_id, slug, title, date, tag, tag_color, description, keywords, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          userId,
          slug,
          meta.title,
          meta.date,
          meta.tag,
          meta.tagColor,
          meta.description,
          meta.keywords,
          sortOrder,
        ],
      );
    } catch {
      await fs.rm(dir, { recursive: true, force: true });
      return { ok: false, error: "保存失败，请重试", status: 500 };
    }

    return { ok: true, slug };
  });
}

/**
 * 替换已有报告的文件（原子替换：dir → old，tmp → dir，删 old；
 * 失败尽力恢复原目录）。不更新元信息。
 */
export async function replaceReportFile(
  userId: string,
  slug: string,
  file: UploadFile,
): Promise<UploadResult> {
  const sizeErr = assertFileSize(file.buf);
  if (sizeErr) return { ok: false, error: sizeErr, status: 400 };

  const userDir = path.join(USERS_DIR, userId);
  const dir = path.join(userDir, slug);
  const tmp = path.join(userDir, `${slug}.tmp`);
  const old = path.join(userDir, `${slug}.old`);
  const isHtmlFile = isHtmlUpload(file);

  // 与上传共用同一把用户级锁：替换场景的存量扣减同样需要串行化
  return withUserStorageLock(userId, async (): Promise<UploadResult> => {
    const capErr = await checkSiteCap();
    if (capErr) return { ok: false, error: capErr, status: 503 };

    // 清理上次失败可能残留的 tmp（避免污染配额计算）
    await fs.rm(tmp, { recursive: true, force: true });

    // 配额预检基数：替换场景下原目录随后会被移除，不计入已用
    const usedBefore = await dirSizeBytes(userDir);
    const oldSize = await dirSizeBytes(dir);

    await fs.mkdir(tmp, { recursive: true });

    try {
      if (isHtmlFile) {
        await fs.writeFile(path.join(tmp, "report.html"), file.buf);
        if (usedBefore - oldSize + file.buf.byteLength > MAX_USER_TOTAL_BYTES) {
          throw new UnzipLimitError(
            `个人存储上限 ${Math.round(MAX_USER_TOTAL_BYTES / (1024 * 1024))}MB，请先删除一些报告再上传`,
          );
        }
      } else {
        const result = await unzipStream(file.buf, tmp);
        if (usedBefore - oldSize + result.totalBytes > MAX_USER_TOTAL_BYTES) {
          throw new UnzipLimitError(
            `个人存储上限 ${Math.round(MAX_USER_TOTAL_BYTES / (1024 * 1024))}MB，请先删除一些报告再上传`,
          );
        }
        await fs.access(path.join(tmp, "report.html"));
      }
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true });
      if (err instanceof UnzipLimitError) {
        return { ok: false, error: err.message, status: 403 };
      }
      return {
        ok: false,
        error: "文件无效或缺少 report.html（入口文件）",
        status: 400,
      };
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
      return { ok: false, error: "替换报告文件失败，请重试", status: 500 };
    }

    return { ok: true, slug };
  });
}

/** 更新报告元信息（不含文件） */
export async function updateReportMeta(
  userId: string,
  slug: string,
  meta: ReportMeta,
): Promise<UploadResult> {
  const invalid = validateReportMeta(meta);
  if (invalid) return { ok: false, error: invalid, status: 400 };
  try {
    const { rowCount } = await db.query(
      `UPDATE reports
       SET title = $1, date = $2, tag = $3, tag_color = $4, description = $5, keywords = $6
       WHERE user_id = $7 AND slug = $8`,
      [meta.title, meta.date, meta.tag, meta.tagColor, meta.description, meta.keywords, userId, slug],
    );
    if (!rowCount) return { ok: false, error: "项目不存在", status: 404 };
    return { ok: true, slug };
  } catch {
    return { ok: false, error: "保存失败，请重试", status: 500 };
  }
}
