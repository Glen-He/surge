export const MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;
// 允许两个调度周期的抖动；首次启动同样享有明确且有限的宽限期。
const MAX_MAINTENANCE_AGE_MS = 3 * MAINTENANCE_INTERVAL_MS;

/** 失败立即降级，失联超时降级；仅新实例首次维护允许启动宽限。 */
export function isMaintenanceHealthy(
  state: { last_succeeded_at: Date | null; last_error: string | null } | undefined,
  now = Date.now(),
  uptimeSeconds = process.uptime(),
): boolean {
  if (state?.last_error) return false;
  if (state?.last_succeeded_at) return now - state.last_succeeded_at.getTime() <= MAX_MAINTENANCE_AGE_MS;
  return uptimeSeconds * 1000 <= MAX_MAINTENANCE_AGE_MS;
}
