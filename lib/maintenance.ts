import {
  purgeExpiredDeletions,
  purgeExpiredPersonalSecurityData,
} from "./account-deletion";
import {
  consumeSharedRateLimit,
  purgeExpiredSecurityRateLimits,
} from "./db-rate-limit";
import { purgeStaleGuests } from "./guest-sandbox";
import { logger } from "./logger";
import {
  purgeOrphanedReportStorage,
  purgeTrash,
  reconcileReportSizes,
} from "./report-storage";
import { db } from "./db";

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
    // One instance per database performs the minute-level sweep. Page/API DAL
    // checks remain exact; this closes idle-browser and closed-tab cleanup to
    // at most one scheduler interval after the absolute 60-minute deadline.
    const lease = await consumeSharedRateLimit(
      "guest-expiry-maintenance",
      "global",
      1,
      GUEST_EXPIRY_INTERVAL_MS / 1000,
    );
    if (lease.allowed) await purgeStaleGuests();
  } catch (error) {
    logger.error("guest-cleanup", "游客过期扫描失败", error as Error);
  } finally {
    guestExpiryRunning = false;
  }
}

export async function runMaintenance(): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    // A database-backed lease coordinates multiple server instances without
    // holding one pool connection while the maintenance functions issue their
    // own queries. This also works when DB_POOL_MAX=1.
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
      ["安全限流清理", purgeExpiredSecurityRateLimits],
      ["个人安全数据保留期清理", purgeExpiredPersonalSecurityData],
      ["到期账号清理", purgeExpiredDeletions],
      ["回收区恢复", purgeTrash],
      ["历史报告容量校准", reconcileReportSizes],
      ["孤儿存储清理", purgeOrphanedReportStorage],
    ];
    const failures: string[] = [];
    for (const [name, task] of tasks) {
      await task().catch((error) => {
        failures.push(name);
        logger.error("maintenance", `${name}失败，继续其他维护任务`, error as Error);
      });
    }
    if (failures.length > 0) {
      await db.query(
        `UPDATE maintenance_state SET last_error = $2, updated_at = NOW() WHERE name = $1`,
        ["full", failures.join("、")],
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
    logger.error("maintenance", "后台维护任务失败", error as Error);
    return false;
  } finally {
    running = false;
  }
}

/** Start one non-blocking maintenance loop per Node.js server process. */
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
