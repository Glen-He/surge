import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { withStorageLocks } from "./db";
import { unzipStream, UnzipLimitError } from "./zip";
import { isGuestEmail } from "./guest-sandbox";
import { logger } from "./logger";
import {
  newReportStorageKey,
  reportArtifactDir,
  reportArtifactsDir,
  reportContentDir,
  reportDir,
  reportStagingDir,
  REPORT_USERS_DIR,
} from "./report-storage";
import {
  ensureStorageHeadroom,
  StorageCapacityError,
} from "./storage-capacity";
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
  externalNetwork: boolean;
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
    // External network access is opt-in for newly created/API-uploaded reports.
    // Existing reports are migrated with TRUE to preserve their behaviour.
    externalNetwork: String(form.get("externalNetwork") ?? "false") === "true",
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
  userId: string,
  storageKey: string,
  file: UploadFile,
): Promise<{ tmp: string; projectBytes: number }> {
  await fs.mkdir(REPORT_USERS_DIR, { recursive: true });
  await ensureStorageHeadroom(REPORT_USERS_DIR, MAX_PROJECT_BYTES);
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

  const slug = `r_${randomUUID().slice(0, 8)}`;
  const storageKey = newReportStorageKey();
  let staged: { tmp: string; projectBytes: number };
  try {
    staged = await stageReportPayload(userId, storageKey, file);
  } catch (err) {
    if (err instanceof UnzipLimitError) {
      return { ok: false, error: err.message, status: 400 };
    }
    if (err instanceof StorageCapacityError) {
      return { ok: false, error: err.message, status: 507 };
    }
    return {
      ok: false,
      error: "文件无效或缺少 report.html（入口文件）",
      status: 400,
    };
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
          return {
            ok: false,
            error: "游客模式最多上传 1 个项目，删除后可再次上传",
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
        await fs.mkdir(reportArtifactsDir(userId), { recursive: true });
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
          `INSERT INTO reports (id, user_id, slug, revision_id, title, date, tag, tag_color, description, keywords, external_network_enabled, sort_order, size_bytes, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            randomUUID(), userId, slug, newRevisionId(), meta.title, meta.date,
            meta.tag, meta.tagColor, meta.description, meta.keywords,
            meta.externalNetwork, sortOrder, staged.projectBytes, storageKey,
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
    if (invalid) return { ok: false, error: invalid, status: 400 };
  }
  const sizeErr = assertFileSize(file.size);
  if (sizeErr) return { ok: false, error: sizeErr, status: 400 };

  try {
    reportDir(userId, slug);
  } catch {
    return { ok: false, error: "项目不存在", status: 404 };
  }
  const storageKey = newReportStorageKey();
  const newDir = reportArtifactDir(userId, storageKey);
  let staged: { tmp: string; projectBytes: number };
  try {
    staged = await stageReportPayload(userId, storageKey, file);
  } catch (err) {
    if (err instanceof UnzipLimitError) {
      return { ok: false, error: err.message, status: 400 };
    }
    if (err instanceof StorageCapacityError) {
      return { ok: false, error: err.message, status: 507 };
    }
    return {
      ok: false,
      error: "文件无效或缺少 report.html（入口文件）",
      status: 400,
    };
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
      if (!current.rows[0]) return { ok: false, error: "项目不存在", status: 404 };
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
        return {
          ok: false,
          error: `个人存储上限 ${Math.round(MAX_USER_TOTAL_BYTES / 1024 / 1024)}MB，请先删除一些报告再上传`,
          status: 403,
        };
      }
      const capErr = checkSiteCap(used.site - oldSize + staged.projectBytes);
      if (capErr) return { ok: false, error: capErr, status: 503 };

      try {
        await fs.mkdir(reportArtifactsDir(userId), { recursive: true });
        await fs.rename(staged.tmp, newDir);
      } catch {
        return { ok: false, error: "替换报告文件失败，请重试", status: 500 };
      }

      // New bytes live in a separate immutable directory. The one-row UPDATE
      // atomically rotates both the capability revision and storage pointer.
      try {
        const updated = meta
          ? await client.query(
              `UPDATE reports
               SET revision_id = $1, title = $2, date = $3, tag = $4,
                   tag_color = $5, description = $6, keywords = $7,
                   external_network_enabled = $8, sort_order = $9, size_bytes = $10,
                   template_key = NULL, storage_key = $11
               WHERE user_id = $12 AND slug = $13`,
              [
                newRevisionId(),
                meta.title,
                meta.date,
                meta.tag,
                meta.tagColor,
                meta.description,
                meta.keywords,
                meta.externalNetwork, nextSortOrder, staged.projectBytes, storageKey, userId, slug,
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
        logger.error("upload", "轮换报告存储指针失败", err as Error);
        await fs.rm(newDir, { recursive: true, force: true }).catch(() => {});
        return { ok: false, error: "替换报告文件失败，请重试", status: 500 };
      }

      if (!current.rows[0].template_key) {
        const oldDir = reportContentDir({
          userId,
          slug,
          storageKey: current.rows[0].storage_key,
        });
        await fs.rm(oldDir, { recursive: true, force: true, maxRetries: 3 }).catch(
          (error) => {
            logger.warn("upload", "旧报告版本将在后台清理", error as Error, {
              userId,
              slug,
            });
          },
        );
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

/** Delete DB authorization first, then reclaim unreferenced physical bytes. */
export async function deleteReport(
  userId: string,
  slug: string,
): Promise<UploadResult> {
  return withStorageLocks(userId, async (client) => {
    try {
      reportDir(userId, slug);
    } catch {
      return { ok: false, error: "项目不存在", status: 404 };
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
        return { ok: false, error: "项目不存在", status: 404 };
      }
      const row = result.rows[0];
      if (!row.template_key) {
        const dir = reportContentDir({
          userId,
          slug,
          storageKey: row.storage_key,
        });
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(
          (error) => {
            logger.warn("report-delete", "报告已失效，文件将在后台清理", error as Error, {
              userId,
              slug,
            });
          },
        );
      }
      return { ok: true, slug };
    } catch (error) {
      logger.error("report-delete", "数据库删除失败", error as Error, {
        userId,
        slug,
      });
      return { ok: false, error: "删除失败，请重试", status: 500 };
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
  if (invalid) return { ok: false, error: invalid, status: 400 };
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
          return { ok: false, error: "项目不存在", status: 404 };
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
               description = $5, keywords = $6, external_network_enabled = $7,
               sort_order = $8
           WHERE user_id = $9 AND slug = $10`,
          [meta.title, meta.date, meta.tag, meta.tagColor, meta.description, meta.keywords, meta.externalNetwork, sortOrder, userId, slug],
        );
        await client.query("COMMIT");
        return { ok: true, slug };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }, { global: false });
  } catch {
    return { ok: false, error: "保存失败，请重试", status: 500 };
  }
}
