import { db } from "./db";
import { withStorageLocks } from "./db";
import { logger } from "./logger";
import {
  moveUserDirToTrash,
  removeTrashedDir,
  restoreTrashedDir,
} from "./report-storage";

// 账号删除冷却期（15 天）：
// - 申请后 deletion_requested_at 记录时间戳，冷却期内可登录、可取消；
// - 到期后 purgeExpiredDeletions() 物理删除 user 行，
//   reports / account_changes / session / account 均 ON DELETE CASCADE 连带清除；
//   security_logs 的 user_id 置 NULL，保留 email 供审计。
export const DELETION_COOLING_DAYS = 15;

export async function getDeletionRequestedAt(
  userId: string,
): Promise<Date | null> {
  const r = await db.query<{ deletion_requested_at: Date | null }>(
    `SELECT deletion_requested_at FROM "user" WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.deletion_requested_at ?? null;
}

export async function scheduleDeletion(userId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE "user"
     SET deletion_requested_at = COALESCE(deletion_requested_at, NOW()),
         version = version + CASE WHEN deletion_requested_at IS NULL THEN 1 ELSE 0 END
     WHERE id = $1`,
    [userId],
  );
  return result.rowCount === 1;
}

export async function cancelDeletion(userId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE "user" SET deletion_requested_at = NULL, version = version + 1
     WHERE id = $1 AND deletion_requested_at IS NOT NULL`,
    [userId],
  );
  return result.rowCount === 1;
}

// 幂等清理：删除冷却期已过的账号。
// 在 instrumentation 启动与首页 / 用户中心加载时调用，无需 cron。
export async function purgeExpiredDeletions(): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM "user"
       WHERE deletion_requested_at IS NOT NULL
         AND deletion_requested_at + INTERVAL '15 days' <= NOW()
       ORDER BY deletion_requested_at ASC
       LIMIT 100`,
    );
    for (const row of rows) {
      await deleteUserPermanently(row.id, "account").catch((error) => {
        logger.error(
          "account-deletion",
          "清理单个到期账号失败，继续处理其他账号",
          error as Error,
          { userId: row.id },
        );
      });
    }
  } catch (err) {
    logger.error("account-deletion", "清理到期删除账号失败", err as Error);
  }
}

/**
 * Compensating transaction for DB + filesystem account deletion.
 *
 * The directory is atomically hidden first. If the conditional DB delete no
 * longer applies (for example the user cancelled concurrently), it is restored.
 * A committed DB deletion leaves any cleanup failure in .trash for startup retry.
 */
export async function deleteUserPermanently(
  userId: string,
  reason: "account" | "guest",
): Promise<boolean> {
  return withStorageLocks(userId, async (client) => {
    const moved = await moveUserDirToTrash(userId, reason);
    try {
      const result =
        reason === "account"
          ? await client.query(
              `DELETE FROM "user"
               WHERE id = $1
                 AND deletion_requested_at IS NOT NULL
                 AND deletion_requested_at + INTERVAL '15 days' <= NOW()`,
              [userId],
            )
          : await client.query(`DELETE FROM "user" WHERE id = $1`, [userId]);

      if (reason === "account" && result.rowCount !== 1) {
        await restoreTrashedDir(
          moved.original,
          moved.trashed,
          moved.manifest,
        );
        return false;
      }
    } catch (error) {
      await restoreTrashedDir(
        moved.original,
        moved.trashed,
        moved.manifest,
      ).catch(
        (restoreError) => {
          logger.error(
            "account-deletion",
            "数据库删除失败且用户目录恢复失败",
            restoreError as Error,
            { userId, reason },
          );
        },
      );
      throw error;
    }

    await removeTrashedDir(moved.trashed, moved.manifest).catch((error) => {
      logger.warn(
        "account-deletion",
        "账号已删除，用户目录将由启动任务重试清理",
        error as Error,
        { userId, reason },
      );
    });
    return true;
  });
}
