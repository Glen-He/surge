import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { withStorageLocks } from "./db";
import { unzipStream, UnzipLimitError } from "./zip";
import { isGuestEmail } from "./guest-sandbox";
import { logger } from "./logger";
import {
  assertSafeReportSlug,
  newReportStorageKey,
  reportArtifactDir,
  reportArtifactsDir,
  reportContentDir,
  reportStagingDir,
  REPORT_DATA_DIR,
} from "./report-storage";
import {
  ensureStorageHeadroom,
  StorageCapacityError,
} from "./storage-capacity";
import { LIMITS, charWeight } from "./char-limit";
import { newRevisionId } from "./report-capability";
import { DEFAULT_TAG_COLOR, isTagColor } from "./tag-colors";
import { uploadFailure, type UploadFailure } from "./upload-errors";
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
  | UploadFailure;

/** 字段校验（两套端点同一规则）：非法时返回结构化错误。 */
export function validateReportMeta(meta: ReportMeta): UploadFailure | null {
  if (!meta.title || !meta.date) {
    return uploadFailure("META_TITLE_DATE_REQUIRED");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    return uploadFailure("META_DATE_FORMAT");
  }
  const [year, month, day] = meta.date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return uploadFailure("META_DATE_INVALID");
  }
  if (meta.tag.length > LIMITS.tag) {
    return uploadFailure("META_TAG_TOO_LONG", { max: LIMITS.tag });
  }
  if (charWeight(meta.title) > LIMITS.title) {
    return uploadFailure("META_TITLE_TOO_LONG", { max: LIMITS.title });
  }
  if (charWeight(meta.keywords) > LIMITS.keywords) {
    return uploadFailure("META_KEYWORDS_TOO_LONG", {
      max: LIMITS.keywords,
    });
  }
  if (charWeight(meta.description) > LIMITS.description) {
    return uploadFailure("META_DESCRIPTION_TOO_LONG", {
      max: LIMITS.description,
    });
  }
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
function isHtmlUpload(file: { name: string; type: string }): boolean {
  return /\.(html?|xhtml)$/i.test(file.name) || file.type === "text/html";
}

/** 单文件大小校验：超限时返回结构化错误。 */
function assertFileSize(size: number): UploadFailure | null {
  if (size > MAX_ZIP_BYTES) {
    return uploadFailure("FILE_TOO_LARGE", {
      max: Math.round(MAX_ZIP_BYTES / 1024 / 1024),
    });
  }
  return null;
}

/** 全站总量闸门（调用方必须持有全站存储锁）：达上限返回结构化错误。 */
function checkSiteCap(siteTotal: number): UploadFailure | null {
  if (siteTotal > SITE_TOTAL_CAP_BYTES) {
    return uploadFailure("SITE_CAP_REACHED");
  }
  if (siteTotal >= SITE_TOTAL_WARN_BYTES) {
    logger.warn("storage", "site storage usage reached warning threshold", {
      usedGB: Number((siteTotal / 1024 ** 3).toFixed(2)),
      warnGB: Math.round(SITE_TOTAL_WARN_BYTES / 1024 ** 3),
      capGB: Math.round(SITE_TOTAL_CAP_BYTES / 1024 ** 3),
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
  userId: string,
  storageKey: string,
  file: UploadFile,
): Promise<{ tmp: string; projectBytes: number }> {
  await fs.mkdir(REPORT_DATA_DIR, { recursive: true });
  await ensureStorageHeadroom(REPORT_DATA_DIR, MAX_PROJECT_BYTES);
  const stagingDir = reportStagingDir(userId);
  const tmp = path.join(stagingDir, `${storageKey}.${randomUUID()}.tmp`);
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
    if (projectBytes <= 0) throw new Error("project payload is empty");
    return { tmp, projectBytes };
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true }).catch((cleanupError) => {
      logger.warn(
        "upload",
        "failed to remove invalid upload staging dir",
        cleanupError as Error,
        { tmp },
      );
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
  if (invalid) return invalid;
  const sizeErr = assertFileSize(file.size);
  if (sizeErr) return sizeErr;

  const slug = `r_${randomUUID().slice(0, 8)}`;
  const storageKey = newReportStorageKey();
  let staged: { tmp: string; projectBytes: number };
  try {
    staged = await stageReportPayload(userId, storageKey, file);
  } catch (err) {
    if (err instanceof UnzipLimitError) {
      return err.toFailure();
    }
    if (err instanceof StorageCapacityError) {
      return err.toFailure();
    }
    return uploadFailure("UPLOAD_INVALID");
  }
  const dir = reportArtifactDir(userId, storageKey);

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
          return uploadFailure("GUEST_UPLOAD_LIMIT");
        }
      }
      const used = await storageTotals(client, userId);
      if (used.user + staged.projectBytes > MAX_USER_TOTAL_BYTES) {
        return uploadFailure(
          "USER_QUOTA_EXCEEDED",
          {
            max: Math.round(MAX_USER_TOTAL_BYTES / 1024 / 1024),
            used: Math.round(used.user / 1024 / 1024),
          },
        );
      }
      const capErr = checkSiteCap(used.site + staged.projectBytes);
      if (capErr) return capErr;

      try {
        await fs.mkdir(reportArtifactsDir(userId), { recursive: true });
        await fs.rename(staged.tmp, dir);
      } catch {
        return uploadFailure("SAVE_FAILED");
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
          `INSERT INTO reports (id, user_id, slug, revision_id, title, date, tag, tag_color, description, keywords, sort_order, size_bytes, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            randomUUID(), userId, slug, newRevisionId(), meta.title, meta.date,
            meta.tag, meta.tagColor, meta.description, meta.keywords,
            sortOrder, staged.projectBytes, storageKey,
          ],
        );
      } catch {
        await fs.rm(dir, { recursive: true, force: true }).catch((error) => {
          logger.warn(
            "upload",
            "failed to remove report dir after db write failure",
            error as Error,
            { userId, slug },
          );
        });
        return uploadFailure("SAVE_FAILED");
      }

      return { ok: true, slug };
    });
  } finally {
    await fs.rm(staged.tmp, { recursive: true, force: true }).catch((error) => {
      logger.warn("upload", "failed to remove upload staging dir", error as Error, {
        userId,
        slug,
      });
    });
  }
}

/**
 * 替换已有报告文件：发布不可变新版本，再原子切换数据库指针。
 * 数据库失败时旧版本完全不动；成功后旧版本可立即或后台回收。
 */
export async function replaceReportFile(
  userId: string,
  slug: string,
  file: UploadFile,
  meta?: ReportMeta,
): Promise<UploadResult> {
  if (meta) {
    const invalid = validateReportMeta(meta);
    if (invalid) return invalid;
  }
  const sizeErr = assertFileSize(file.size);
  if (sizeErr) return sizeErr;

  try {
    assertSafeReportSlug(slug);
  } catch {
    return uploadFailure("REPORT_NOT_FOUND");
  }
  const storageKey = newReportStorageKey();
  const newDir = reportArtifactDir(userId, storageKey);
  let staged: { tmp: string; projectBytes: number };
  try {
    staged = await stageReportPayload(userId, storageKey, file);
  } catch (err) {
    if (err instanceof UnzipLimitError) {
      return err.toFailure();
    }
    if (err instanceof StorageCapacityError) {
      return err.toFailure();
    }
    return uploadFailure("UPLOAD_INVALID");
  }

  try {
    return await withStorageLocks(userId, async (client): Promise<UploadResult> => {
      const current = await client.query<{
        size_bytes: string;
        template_key: string | null;
        storage_key: string | null;
        date: string;
        sort_order: number | null;
      }>(
        `SELECT size_bytes::text, template_key, storage_key, date, sort_order
         FROM reports WHERE user_id = $1 AND slug = $2`,
        [userId, slug],
      );
      if (!current.rows[0]) {
        return uploadFailure("REPORT_NOT_FOUND");
      }
      const oldSize = Number(current.rows[0].size_bytes);
      let nextSortOrder = current.rows[0].sort_order;
      if (meta && meta.date !== current.rows[0].date) {
        const order = await client.query<{ m: number }>(
          `SELECT COALESCE(MAX(sort_order), -1) AS m
           FROM reports WHERE user_id = $1 AND date = $2`,
          [userId, meta.date],
        );
        nextSortOrder = Number(order.rows[0]?.m ?? -1) + 1;
      }
      const used = await storageTotals(client, userId);
      if (used.user - oldSize + staged.projectBytes > MAX_USER_TOTAL_BYTES) {
        return uploadFailure(
          "USER_QUOTA_REPLACE_EXCEEDED",
          {
            max: Math.round(MAX_USER_TOTAL_BYTES / 1024 / 1024),
          },
        );
      }
      const capErr = checkSiteCap(used.site - oldSize + staged.projectBytes);
      if (capErr) return capErr;

      try {
        await fs.mkdir(reportArtifactsDir(userId), { recursive: true });
        await fs.rename(staged.tmp, newDir);
      } catch {
        return uploadFailure("REPLACE_FAILED");
      }

      // 新字节写入独立不可变目录；单行 UPDATE 同时原子轮换 capability
      // revision 与存储指针。
      try {
        const updated = meta
          ? await client.query(
              `UPDATE reports
               SET revision_id = $1, title = $2, date = $3, tag = $4,
                   tag_color = $5, description = $6, keywords = $7,
                   sort_order = $8, size_bytes = $9,
                   template_key = NULL, storage_key = $10
               WHERE user_id = $11 AND slug = $12`,
              [
                newRevisionId(),
                meta.title,
                meta.date,
                meta.tag,
                meta.tagColor,
                meta.description,
                meta.keywords,
                nextSortOrder, staged.projectBytes, storageKey, userId, slug,
              ],
            )
          : await client.query(
              `UPDATE reports
               SET revision_id = $1, size_bytes = $2, template_key = NULL,
                   storage_key = $3
               WHERE user_id = $4 AND slug = $5`,
              [newRevisionId(), staged.projectBytes, storageKey, userId, slug],
            );
        if (updated.rowCount !== 1) {
          throw new Error("report disappeared while rotating revision");
        }
      } catch (err) {
        logger.error("upload", "failed to rotate report storage pointer", err as Error);
        await fs.rm(newDir, { recursive: true, force: true }).catch(() => {});
        return uploadFailure("REPLACE_FAILED");
      }

      if (!current.rows[0].template_key) {
        const oldDir = reportContentDir({
          userId,
          storageKey: current.rows[0].storage_key,
        });
        await fs.rm(oldDir, { recursive: true, force: true, maxRetries: 3 }).catch(
          (error) => {
            logger.warn(
              "upload",
              "old report revision left for background cleanup",
              error as Error,
              { userId, slug },
            );
          },
        );
      }

      return { ok: true, slug };
    });
  } finally {
    await fs.rm(staged.tmp, { recursive: true, force: true }).catch((error) => {
      logger.warn("upload", "failed to remove upload staging dir", error as Error, {
        userId,
        slug,
      });
    });
  }
}

/** 先删数据库授权，再回收失去引用的物理字节 */
export async function deleteReport(
  userId: string,
  slug: string,
): Promise<UploadResult> {
  return withStorageLocks(userId, async (client) => {
    try {
      assertSafeReportSlug(slug);
    } catch {
      return uploadFailure("REPORT_NOT_FOUND");
    }
    try {
      const result = await client.query<{
        template_key: string | null;
        storage_key: string | null;
      }>(
        `DELETE FROM reports WHERE user_id = $1 AND slug = $2
         RETURNING template_key, storage_key`,
        [userId, slug],
      );
      if (result.rowCount !== 1) {
        return uploadFailure("REPORT_NOT_FOUND");
      }
      const row = result.rows[0];
      if (!row.template_key) {
        const dir = reportContentDir({
          userId,
          storageKey: row.storage_key,
        });
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(
          (error) => {
            logger.warn(
              "report-delete",
              "deleted report files left on disk after removal failure",
              error as Error,
              { userId, slug },
            );
          },
        );
      }
      return { ok: true, slug };
    } catch (error) {
      logger.error("report-delete", "report delete failed", error as Error, {
        userId,
        slug,
      });
      return uploadFailure("DELETE_FAILED");
    }
  });
}

/** 更新报告元信息（不含文件） */
export async function updateReportMeta(
  userId: string,
  slug: string,
  meta: ReportMeta,
): Promise<UploadResult> {
  const invalid = validateReportMeta(meta);
  if (invalid) return invalid;
  try {
    return await withStorageLocks(userId, async (client): Promise<UploadResult> => {
      await client.query("BEGIN");
      try {
        const current = await client.query<{ date: string; sort_order: number | null }>(
          `SELECT date, sort_order FROM reports
           WHERE user_id = $1 AND slug = $2 FOR UPDATE`,
          [userId, slug],
        );
        if (!current.rows[0]) {
          await client.query("ROLLBACK");
          return uploadFailure("REPORT_NOT_FOUND");
        }
        let sortOrder = current.rows[0].sort_order;
        if (meta.date !== current.rows[0].date) {
          const target = await client.query<{ m: number }>(
            `SELECT COALESCE(MAX(sort_order), -1) AS m
             FROM reports WHERE user_id = $1 AND date = $2`,
            [userId, meta.date],
          );
          sortOrder = Number(target.rows[0]?.m ?? -1) + 1;
        }
        await client.query(
          `UPDATE reports
           SET title = $1, date = $2, tag = $3, tag_color = $4,
               description = $5, keywords = $6, sort_order = $7
           WHERE user_id = $8 AND slug = $9`,
          [meta.title, meta.date, meta.tag, meta.tagColor, meta.description, meta.keywords, sortOrder, userId, slug],
        );
        await client.query("COMMIT");
        return { ok: true, slug };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }, { global: false });
  } catch {
    return uploadFailure("SAVE_FAILED");
  }
}
