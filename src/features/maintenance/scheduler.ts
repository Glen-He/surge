import {
  purgeExpiredDeletions,
  purgeExpiredPersonalSecurityData,
} from "@/features/account/account-deletion";
import {
  consumeSharedRateLimit,
  purgeExpiredSecurityRateLimits,
} from "@/infrastructure/database/rate-limit";
import { purgeStaleGuests } from "@/features/guest/guest-sandbox";
import { logger } from "@/infrastructure/logging/logger";
import {
  purgeOrphanedReportStorage,
  purgeTrash,
} from "@/features/reports/storage/report-storage";
import { db } from "@/infrastructure/database/client";

const MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
const GUEST_EXPIRY_INTERVAL_MS = 60 * 1000;
let running = false;
let guestExpiryRunning = false;
let timer: NodeJS.Timeout | null = null;
let guestExpiryTimer: NodeJS.Timeout | null = null;

async function runGuestExpiryMaintenance(): Promise<void> {
  if (guestExpiryRunning) return;
  guestExpiryRunning = true;
  try {
    // 每个数据库只由一个实例执行分钟级扫描。页面/API 的 DAL 检查仍然精确；
    // 这里把闲置浏览器与已关标签页的清理误差收敛到绝对 60 分钟死线后
    // 至多一个调度周期。
    const lease = await consumeSharedRateLimit(
      "guest-expiry-maintenance",
      "global",
      1,
      GUEST_EXPIRY_INTERVAL_MS / 1000,
    );
    if (lease.allowed) await purgeStaleGuests();
  } catch (error) {
    logger.error("guest-cleanup", "guest expiry sweep failed", error as Error);
  } finally {
    guestExpiryRunning = false;
  }
}

export async function runMaintenance(): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    // 数据库背书的租约协调多实例，且不在维护函数各自发起查询时占用
    // 池连接；DB_POOL_MAX=1 时同样可用。
    const lease = await consumeSharedRateLimit(
      "maintenance",
      "global",
      1,
      MAINTENANCE_INTERVAL_MS / 1000,
    );
    if (!lease.allowed) return false;
    await db.query(
      `INSERT INTO maintenance_state (name, last_started_at, last_error)
       VALUES ('full', NOW(), NULL)
       ON CONFLICT (name) DO UPDATE SET last_started_at = NOW(), last_error = NULL, updated_at = NOW()`,
    );
    const tasks: Array<[string, () => Promise<unknown>]> = [
      ["security-rate-limit-purge", purgeExpiredSecurityRateLimits],
      ["personal-security-data-purge", purgeExpiredPersonalSecurityData],
      ["expired-account-purge", purgeExpiredDeletions],
      ["trash-recovery", purgeTrash],
      ["orphaned-storage-purge", purgeOrphanedReportStorage],
    ];
    const failures: string[] = [];
    for (const [name, task] of tasks) {
      await task().catch((error) => {
        failures.push(name);
        logger.error("maintenance", "task failed; continuing with others", error as Error, {
          task: name,
        });
      });
    }
    if (failures.length > 0) {
      await db.query(
        `UPDATE maintenance_state SET last_error = $2, updated_at = NOW() WHERE name = $1`,
        ["full", failures.join(", ")],
      );
      throw new Error(`maintenance tasks failed: ${failures.join(", ")}`);
    }
    await db.query(
      `UPDATE maintenance_state
       SET last_succeeded_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE name = 'full'`,
    );
    return true;
  } catch (error) {
    logger.error("maintenance", "background maintenance run failed", error as Error);
    return false;
  } finally {
    running = false;
  }
}

/** 每个 Node.js 服务进程启动一个非阻塞的维护循环 */
export function startMaintenanceScheduler(): void {
  if (timer || guestExpiryTimer) return;
  setTimeout(() => void runMaintenance(), 0).unref();
  setTimeout(() => void runGuestExpiryMaintenance(), 0).unref();
  timer = setInterval(() => void runMaintenance(), MAINTENANCE_INTERVAL_MS);
  guestExpiryTimer = setInterval(
    () => void runGuestExpiryMaintenance(),
    GUEST_EXPIRY_INTERVAL_MS,
  );
  timer.unref();
  guestExpiryTimer.unref();
}
