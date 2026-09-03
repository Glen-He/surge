import { serverEnv } from "@/infrastructure/environment/server";
import { db } from "@/infrastructure/database/client";
import { withStorageLocks } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/logging/logger";
import {
  moveUserDirToTrash,
  removeTrashedDir,
  restoreTrashedDir,
} from "@/features/reports/storage/report-storage";

// 账号删除冷却期（15 天）：
// - 申请后 deletion_requested_at 记录时间戳，冷却期内可登录、可取消；
// - 到期后 purgeExpiredDeletions() 物理删除 user 行，
//   reports / account_changes / session / account 均 ON DELETE CASCADE 连带清除；
//   邮箱 OTP、验证记录和含邮箱/IP 的安全日志在同一事务内主动清除。
const DELETION_COOLING_DAYS = 15;

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
// 由进程内后台维护调度器周期调用，不占用用户页面请求。
export async function purgeExpiredDeletions(): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM "user"
     WHERE deletion_requested_at IS NOT NULL
       AND deletion_requested_at + ($1::integer * INTERVAL '1 day') <= NOW()
     ORDER BY deletion_requested_at ASC
     LIMIT 100`,
    [DELETION_COOLING_DAYS],
  );
  let failures = 0;
  for (const row of rows) {
    await deleteUserPermanently(row.id, "account").catch((error) => {
      failures += 1;
      logger.error(
        "account-deletion",
        "failed to purge one expired account; continuing with others",
        error as Error,
        { userId: row.id },
      );
    });
  }
  if (failures > 0) {
    throw new Error(`${failures} expired account deletions failed`);
  }
}

/**
 * 数据库 + 文件系统账号删除的补偿事务。
 *
 * 目录先被原子隐藏；若条件删除在数据库侧已不成立（例如用户并发取消了删除），
 * 则恢复目录。数据库删除提交后，残余清理失败保留在 .trash 交由启动任务重试。
 */
export async function deleteUserPermanently(
  userId: string,
  reason: "account" | "guest",
): Promise<boolean> {
  return withStorageLocks(userId, async (client) => {
    const moved = await moveUserDirToTrash(userId, reason);
    try {
      await client.query("BEGIN");
      const user = await client.query<{ email: string }>(
        reason === "account"
          ? `SELECT email FROM "user"
             WHERE id = $1
               AND deletion_requested_at IS NOT NULL
               AND deletion_requested_at + ($2::integer * INTERVAL '1 day') <= NOW()
             FOR UPDATE`
          : `SELECT email FROM "user" WHERE id = $1 FOR UPDATE`,
        reason === "account" ? [userId, DELETION_COOLING_DAYS] : [userId],
      );
      const email = user.rows[0]?.email;
      if (!email) {
        await client.query("ROLLBACK");
        await restoreTrashedDir(
          moved.original,
          moved.trashed,
          moved.manifest,
        );
        return false;
      }

      await client.query(
        `DELETE FROM security_logs
         WHERE user_id = $1 OR lower(email) = lower($2)`,
        [userId, email],
      );
      await client.query(`DELETE FROM otp_codes WHERE lower(email) = lower($1)`, [
        email,
      ]);
      // Better Auth 的 identifier 要么是邮箱本身，要么是
      // "<purpose>-otp-<email>"。用后缀比较，避免把邮箱中的
      // % 和 _ 等字符当作 LIKE 通配符。
      await client.query(
        `DELETE FROM verification
         WHERE lower(identifier) = lower($1)
            OR right(lower(identifier), length($1) + 5) = '-otp-' || lower($1)`,
        [email],
      );
      const result = await client.query(`DELETE FROM "user" WHERE id = $1`, [
        userId,
      ]);
      if (result.rowCount !== 1) throw new Error("user disappeared during deletion");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      await restoreTrashedDir(
        moved.original,
        moved.trashed,
        moved.manifest,
      ).catch(
        (restoreError) => {
          logger.error(
            "account-deletion",
            "db deletion failed and user dir restore also failed",
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
        "account deleted; user dir left for startup retry",
        error as Error,
        { userId, reason },
      );
    });
    return true;
  }, { global: false });
}

/** 清理短期凭证，并按保留策略裁剪包含个人信息的审计数据。 */
export async function purgeExpiredPersonalSecurityData(): Promise<void> {
  // int 项：缺省回落 90，非法值（非整数/越界）在启动校验即拒绝
  const days = serverEnv.SECURITY_LOG_RETENTION_DAYS;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM otp_codes
       WHERE expires_at <= NOW() OR (consumed = TRUE AND created_at < NOW() - INTERVAL '1 day')`,
    );
    await client.query(`DELETE FROM verification WHERE "expiresAt" <= NOW()`);
    await client.query(
      `DELETE FROM account_changes
       WHERE expires_at <= NOW() OR (consumed = TRUE AND created_at < NOW() - INTERVAL '7 days')`,
    );
    await client.query(
      `DELETE FROM security_logs
       WHERE id IN (
         SELECT id FROM security_logs
         WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
         ORDER BY created_at ASC
         LIMIT 1000
       )`,
      [days],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
