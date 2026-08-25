import { db } from "./db";
import { logger } from "./logger";

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

export async function scheduleDeletion(userId: string): Promise<void> {
  await db.query(
    `UPDATE "user" SET deletion_requested_at = NOW(), version = version + 1
     WHERE id = $1`,
    [userId],
  );
}

export async function cancelDeletion(userId: string): Promise<void> {
  await db.query(
    `UPDATE "user" SET deletion_requested_at = NULL, version = version + 1
     WHERE id = $1`,
    [userId],
  );
}

// 幂等清理：删除冷却期已过的账号。
// 在 instrumentation 启动与首页 / 用户中心加载时调用，无需 cron。
export async function purgeExpiredDeletions(): Promise<void> {
  try {
    await db.query(
      `DELETE FROM "user"
       WHERE deletion_requested_at IS NOT NULL
         AND deletion_requested_at + INTERVAL '15 days' <= NOW()`,
    );
  } catch (err) {
    logger.error("account-deletion", "清理到期删除账号失败", err as Error);
  }
}
