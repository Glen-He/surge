import { promises as fs } from "fs";
import { withStorageLocks } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/logging/logger";
import {
  assertSafeReportSlug,
  reportContentDir,
} from "../storage/report-storage";
import { uploadFailure } from "@/features/reports/upload/upload-errors";
import type { UploadResult } from "./upload-report";

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
