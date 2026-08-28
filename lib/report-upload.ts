import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { db, withStorageLocks } from "./db";
import { unzipStream, UnzipLimitError } from "./zip";
import { isGuestEmail } from "./guest-sandbox";
import { logger } from "./logger";
import {
  moveReportDirToTrash,
  removeTrashedDir,
  reportDir,
  REPORT_USERS_DIR,
  restoreTrashedDir,
  userReportsDir,
} from "./report-storage";
import { LIMITS, charWeight } from "./char-limit";
import { newRevisionId } from "./report-capability";
import { DEFAULT_TAG_COLOR, isTagColor } from "./tag-colors";
import {
  MAX_ZIP_BYTES,
  MAX_PROJECT_BYTES,
  MAX_FILES,
  MAX_DEPTH,
  MAX_USER_TOTAL_BYTES,
  SITE_TOTAL_CAP_BYTES,
  SITE_TOTAL_WARN_BYTES,
} from "./storage-limits";

// ── 报告上传核心 ──
// 网页端（/api/reports*，会话认证）与开放 API（/api/v1/reports*，令牌认证）
// 共用这一份业务实现：字段校验、配额、advisory lock 串行化、
// 临时目录转正/原子替换。任何规则改动只改这里。

export const USERS_DIR = REPORT_USERS_DIR;

export type ReportMeta = {
  title: string;
  date: string;
  tag: string;
  tagColor: string;
  description: string;
  keywords: string;
};

export type UploadFile = { name: string; type: string; path: string; size: number };

export type UploadResult =
  | { ok: true; slug: string }
  | { ok: false; error: string; status: number };

/** 字段校验（两套端点同一规则） */
export function validateReportMeta(meta: ReportMeta): string | null {
  if (!meta.title || !meta.date) return "标题和日期必填";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) return "日期格式必须为 YYYY-MM-DD";
  const [year, month, day] = meta.date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return "请填写有效日期";
  }
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

function assertFileSize(size: number): string | null {
  if (size > MAX_ZIP_BYTES) return "文件超过 50MB 上限";
  return null;
}

/** 全站总量闸门（调用方必须持有全站存储锁）。 */
function checkSiteCap(siteTotal: number): string | null {
  if (siteTotal > SITE_TOTAL_CAP_BYTES) {
    return "服务器存储已达上限，上传暂停，请联系管理员";
  }
  if (siteTotal >= SITE_TOTAL_WARN_BYTES) {
    logger.warn("storage", "全站占用已达预警线", {
      usedGB: Number((siteTotal / 1024 ** 3).toFixed(2)),
      warnGB: 16,
      capGB: 20,
    });
  }
  return null;
}

async function storageTotals(
  client: import("pg").PoolClient,
  userId: string,
): Promise<{ user: number; site: number }> {
  const { rows } = await client.query<{ user_bytes: string; site_bytes: string }>(
    `SELECT COALESCE(SUM(size_bytes) FILTER (WHERE user_id = $1), 0)::text AS user_bytes,
            COALESCE(SUM(size_bytes), 0)::text AS site_bytes
     FROM reports`,
    [userId],
  );
  return {
    user: Number(rows[0]?.user_bytes ?? 0),
    site: Number(rows[0]?.site_bytes ?? 0),
  };
}

async function stageReportPayload(
  userDir: string,
  slug: string,
  file: UploadFile,
): Promise<{ tmp: string; projectBytes: number }> {
  const tmp = path.join(userDir, `${slug}.${randomUUID()}.tmp`);
  await fs.mkdir(tmp, { recursive: true });
  try {
    let projectBytes: number;
    if (isHtmlUpload(file)) {
      await fs.copyFile(file.path, path.join(tmp, "report.html"));
      projectBytes = file.size;
    } else {
      const result = await unzipStream(file.path, tmp, {
        maxFiles: MAX_FILES,
        maxTotalBytes: MAX_PROJECT_BYTES,
        maxDepth: MAX_DEPTH,
      });
      projectBytes = result.totalBytes;
      await fs.access(path.join(tmp, "report.html"));
    }
    return { tmp, projectBytes };
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true }).catch((cleanupError) => {
      logger.warn("upload", "清理无效上传暂存目录失败", cleanupError as Error, {
        tmp,
      });
    });
    throw error;
  }
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
  const sizeErr = assertFileSize(file.size);
  if (sizeErr) return { ok: false, error: sizeErr, status: 400 };

  const userDir = userReportsDir(userId);
  const slug = `r_${randomUUID().slice(0, 8)}`;
  let staged: { tmp: string; projectBytes: number };
  try {
    staged = await stageReportPayload(userDir, slug, file);
  } catch (err) {
    if (err instanceof UnzipLimitError) {
      return { ok: false, error: err.message, status: 400 };
    }
    return {
      ok: false,
      error: "文件无效或缺少 report.html（入口文件）",
      status: 400,
    };
  }
  const dir = reportDir(userId, slug);

  try {
    // 解压在锁外完成；锁内只做最终配额确认、原子转正和入库。
    return await withStorageLocks(userId, async (client): Promise<UploadResult> => {
      if (isGuestEmail(email)) {
        const own = await client.query<{ n: string }>(
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
      const used = await storageTotals(client, userId);
      if (used.user + staged.projectBytes > MAX_USER_TOTAL_BYTES) {
        return {
          ok: false,
          error: `个人存储上限 ${Math.round(MAX_USER_TOTAL_BYTES / 1024 / 1024)}MB（已用 ${Math.round(used.user / 1024 / 1024)}MB），请先删除一些报告再上传`,
          status: 403,
        };
      }
      const capErr = checkSiteCap(used.site + staged.projectBytes);
      if (capErr) return { ok: false, error: capErr, status: 503 };

      try {
        await fs.rename(staged.tmp, dir);
      } catch {
        return { ok: false, error: "保存失败，请重试", status: 500 };
      }

      try {
        // 日期是第一排序键；新项目追加到同一天已有项目之后，之后可拖动调整。
        const maxRow = await client.query<{ m: number }>(
          `SELECT COALESCE(MAX(sort_order), -1) AS m
           FROM reports WHERE user_id = $1 AND date = $2`,
          [userId, meta.date],
        );
        const sortOrder = Number(maxRow.rows[0]?.m ?? -1) + 1;
        await client.query(
          `INSERT INTO reports (id, user_id, slug, revision_id, title, date, tag, tag_color, description, keywords, sort_order, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            randomUUID(), userId, slug, newRevisionId(), meta.title, meta.date,
            meta.tag, meta.tagColor, meta.description, meta.keywords,
            sortOrder, staged.projectBytes,
          ],
        );
      } catch {
        await fs.rm(dir, { recursive: true, force: true }).catch((error) => {
          logger.warn("upload", "数据库写入失败后清理报告目录失败", error as Error, {
            userId,
            slug,
          });
        });
        return { ok: false, error: "保存失败，请重试", status: 500 };
      }

      return { ok: true, slug };
    });
  } finally {
    await fs.rm(staged.tmp, { recursive: true, force: true }).catch((error) => {
      logger.warn("upload", "清理上传临时目录失败", error as Error, {
        userId,
        slug,
      });
    });
  }
}

/**
 * 替换已有报告的文件（原子替换：dir → old，tmp → dir，删 old；
 * 失败尽力恢复原目录）。不更新元信息。
 */
export async function replaceReportFile(
  userId: string,
  slug: string,
  file: UploadFile,
  meta?: ReportMeta,
): Promise<UploadResult> {
  if (meta) {
    const invalid = validateReportMeta(meta);
    if (invalid) return { ok: false, error: invalid, status: 400 };
  }
  const sizeErr = assertFileSize(file.size);
  if (sizeErr) return { ok: false, error: sizeErr, status: 400 };

  const userDir = userReportsDir(userId);
  let dir: string;
  try {
    dir = reportDir(userId, slug);
  } catch {
    return { ok: false, error: "项目不存在", status: 404 };
  }
  const old = path.join(userDir, `${slug}.old`);
  let staged: { tmp: string; projectBytes: number };
  try {
    staged = await stageReportPayload(userDir, slug, file);
  } catch (err) {
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
    return await withStorageLocks(userId, async (client): Promise<UploadResult> => {
      const current = await client.query<{ size_bytes: string }>(
        `SELECT size_bytes::text FROM reports WHERE user_id = $1 AND slug = $2`,
        [userId, slug],
      );
      if (!current.rows[0]) return { ok: false, error: "项目不存在", status: 404 };
      const oldSize = Number(current.rows[0].size_bytes);
      const used = await storageTotals(client, userId);
      if (used.user - oldSize + staged.projectBytes > MAX_USER_TOTAL_BYTES) {
        return {
          ok: false,
          error: `个人存储上限 ${Math.round(MAX_USER_TOTAL_BYTES / 1024 / 1024)}MB，请先删除一些报告再上传`,
          status: 403,
        };
      }
      const capErr = checkSiteCap(used.site - oldSize + staged.projectBytes);
      if (capErr) return { ok: false, error: capErr, status: 503 };

      let originalMoved = false;
      try {
        await fs.rm(old, { recursive: true, force: true });
        await fs.rename(dir, old);
        originalMoved = true;
        await fs.rename(staged.tmp, dir);
      } catch {
        if (originalMoved) {
          try {
            await fs.rm(dir, { recursive: true, force: true });
            await fs.rename(old, dir);
          } catch {
            // Recovery is handled fail-closed by the missing live directory.
          }
        }
        return { ok: false, error: "替换报告文件失败，请重试", status: 500 };
      }

      // 内容世代轮换。必须 fail closed：旧 capability 绑定旧 revision，
      // 若磁盘已是新内容而 DB 仍指旧 revision，旧 capability 持有者会读到
      // 未被授权的新内容。因此 DB 更新失败时回滚目录到旧内容；连回滚都
      // 失败则报告目录缺失，runtime 对该报告整体 404。
      try {
        const updated = meta
          ? await client.query(
              `UPDATE reports
               SET revision_id = $1, title = $2, date = $3, tag = $4,
                   tag_color = $5, description = $6, keywords = $7, size_bytes = $8
               WHERE user_id = $9 AND slug = $10`,
              [
                newRevisionId(),
                meta.title,
                meta.date,
                meta.tag,
                meta.tagColor,
                meta.description,
                meta.keywords,
                staged.projectBytes,
                userId,
                slug,
              ],
            )
          : await client.query(
              `UPDATE reports SET revision_id = $1, size_bytes = $2
               WHERE user_id = $3 AND slug = $4`,
              [newRevisionId(), staged.projectBytes, userId, slug],
            );
        if (updated.rowCount !== 1) {
          throw new Error("report disappeared while rotating revision");
        }
      } catch (err) {
        logger.error("upload", "轮换 revision 失败，回滚报告目录", err as Error);
        try {
          await fs.rm(dir, { recursive: true, force: true });
          await fs.rename(old, dir);
        } catch (restoreErr) {
          logger.error(
            "upload",
            "回滚报告目录失败，报告暂不可用（fail closed）",
            restoreErr as Error,
          );
        }
        return { ok: false, error: "替换报告文件失败，请重试", status: 500 };
      }
      await fs.rm(old, { recursive: true, force: true }).catch((error) => {
        logger.warn("upload", "旧报告目录将在下次替换时重试清理", error as Error, {
          userId,
          slug,
        });
      });

      return { ok: true, slug };
    });
  } finally {
    await fs.rm(staged.tmp, { recursive: true, force: true }).catch((error) => {
      logger.warn("upload", "清理上传临时目录失败", error as Error, {
        userId,
        slug,
      });
    });
  }
}

/**
 * Delete a report with a compensating filesystem transaction. The live
 * directory is renamed out of reach first; a failed DB delete restores it.
 * Once the DB commit succeeds, stale capabilities fail before physical cleanup.
 */
export async function deleteReport(
  userId: string,
  slug: string,
): Promise<UploadResult> {
  return withStorageLocks(userId, async (client) => {
    const userDir = userReportsDir(userId);
    try {
      reportDir(userId, slug);
    } catch {
      return { ok: false, error: "项目不存在", status: 404 };
    }
    const tmp = path.join(userDir, `${slug}.tmp`);
    const old = path.join(userDir, `${slug}.old`);
    let moved: Awaited<ReturnType<typeof moveReportDirToTrash>>;
    try {
      moved = await moveReportDirToTrash(userId, slug);
    } catch (error) {
      logger.error("report-delete", "报告目录移入回收区失败", error as Error, {
        userId,
        slug,
      });
      return { ok: false, error: "删除失败，请重试", status: 500 };
    }

    try {
      const result = await client.query(
        `DELETE FROM reports WHERE user_id = $1 AND slug = $2`,
        [userId, slug],
      );
      if (result.rowCount !== 1) {
        await restoreTrashedDir(
          moved.original,
          moved.trashed,
          moved.manifest,
        );
        return { ok: false, error: "项目不存在", status: 404 };
      }
    } catch (error) {
      await restoreTrashedDir(
        moved.original,
        moved.trashed,
        moved.manifest,
      ).catch((restoreError) => {
        logger.error(
          "report-delete",
          "数据库删除失败且目录恢复失败",
          restoreError as Error,
          { userId, slug },
        );
      });
      logger.error("report-delete", "数据库删除失败", error as Error, {
        userId,
        slug,
      });
      return { ok: false, error: "删除失败，请重试", status: 500 };
    }

    // DB 已成功，物理清理失败时留在 .trash，由启动清理重试。
    await Promise.all([
      removeTrashedDir(moved.trashed, moved.manifest),
      fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }),
      fs.rm(old, { recursive: true, force: true, maxRetries: 3 }),
    ]).catch((error) => {
      logger.warn("report-delete", "延迟清理报告回收区", error as Error, {
        userId,
        slug,
      });
    });
    return { ok: true, slug };
  }, { global: false });
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
