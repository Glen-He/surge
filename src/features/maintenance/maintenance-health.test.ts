import { describe, expect, it } from "vitest";
import { isMaintenanceHealthy } from "./maintenance-health";

describe("维护就绪状态", () => {
  const now = 1_800_000_000_000;
  it("近期成功正常，失败和超过三个周期降级", () => {
    expect(isMaintenanceHealthy({ last_succeeded_at: new Date(now - 60_000), last_error: null }, now)).toBe(true);
    expect(isMaintenanceHealthy({ last_succeeded_at: new Date(now), last_error: "trash-recovery" }, now)).toBe(false);
    expect(isMaintenanceHealthy({ last_succeeded_at: new Date(now - 46 * 60_000), last_error: null }, now)).toBe(false);
  });
  it("首次维护只允许有限启动宽限", () => {
    expect(isMaintenanceHealthy(undefined, now, 30)).toBe(true);
    expect(isMaintenanceHealthy(undefined, now, 46 * 60)).toBe(false);
  });
});
