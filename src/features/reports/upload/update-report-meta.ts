import { withStorageLocks } from "@/infrastructure/database/client";
import {
  validateReportMeta,
  type ReportMeta,
} from "./validate-report-meta";
import { uploadFailure } from "@/features/reports/upload/upload-errors";
import type { UploadResult } from "./upload-report";

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
