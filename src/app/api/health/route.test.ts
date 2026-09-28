import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), available: vi.fn() }));
vi.mock("@/infrastructure/database/client", () => ({ db: { query: mocks.query } }));
vi.mock("node:fs", () => ({ constants: { R_OK: 4, W_OK: 2 }, promises: { access: mocks.access } }));
vi.mock("@/features/reports/storage/report-storage", () => ({ REPORT_DATA_DIR: "/isolated-test-reports" }));
vi.mock("@/features/reports/storage/storage-capacity", () => ({ availableBytes: mocks.available, STORAGE_MIN_FREE_BYTES: 10 }));
import { GET } from "./route";

describe("公开健康检查", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.available.mockResolvedValue(100);
  });
  it("失败详情不对外返回，仍正确报告降级状态", async () => {
    mocks.query.mockResolvedValue({ rows: [{ last_succeeded_at: new Date(), last_error: "private-maintenance-detail" }] });
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.maintenance).not.toHaveProperty("lastError");
    expect(JSON.stringify(body)).not.toContain("private-maintenance-detail");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("存储不可用时也不会暴露底层异常", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.access.mockRejectedValue(new Error("private storage path"));
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
