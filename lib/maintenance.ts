import { purgeExpiredDeletions } from "./account-deletion";
import {
  consumeSharedRateLimit,
  purgeExpiredSecurityRateLimits,
} from "./db-rate-limit";
import { purgeStaleGuests } from "./guest-sandbox";
import { logger } from "./logger";
import { purgeTrash } from "./report-storage";

const MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
let running = false;
let timer: NodeJS.Timeout | null = null;

export async function runMaintenance(): Promise<void> {
  if (running) return;
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
    if (!lease.allowed) return;
    await purgeExpiredSecurityRateLimits();
    await purgeStaleGuests();
    await purgeExpiredDeletions();
    await purgeTrash();
  } catch (error) {
    logger.error("maintenance", "后台维护任务失败", error as Error);
  } finally {
    running = false;
  }
}

/** Start one non-blocking maintenance loop per Node.js server process. */
export function startMaintenanceScheduler(): void {
  if (timer) return;
  setTimeout(() => void runMaintenance(), 0).unref();
  timer = setInterval(() => void runMaintenance(), MAINTENANCE_INTERVAL_MS);
  timer.unref();
}
