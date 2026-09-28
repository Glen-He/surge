import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/infrastructure/database/client", () => ({
  db: { query: mocks.query },
  withStorageLocks: (_userId: string, callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }),
}));
import { reorderReports } from "./reports-db";
const current = [{ slug: "one", date: "2026-09-01" }, { slug: "two", date: "2026-09-02" }];
describe("报告排序事务", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockImplementation(async (sql: string) => sql.includes("SELECT slug") ? { rows: current } : { rowCount: 2 });
  });
  it.each([
    [current[0], current[0]],
    [current[0], { slug: "someone-elses-report", date: "2026-09-02" }],
    [current[0], { slug: "two", date: "2026-10-01" }],
    [current[0]],
  ])("拒绝重复、越权、非法分组或不完整列表 %#", async (...items) => {
    expect(await reorderReports("owner", items, current)).toBe("mismatch");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE reports"))).toBe(false);
    expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("旧顺序不能覆盖新的已保存顺序", async () => {
    expect(await reorderReports("owner", current, [...current].reverse())).toBe("stale");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE reports"))).toBe(false);
  });
  it("合法跨现有日期排序在完成校验后提交", async () => {
    expect(await reorderReports("owner", [{ ...current[1], date: current[0].date }, current[0]], current)).toBe("updated");
    expect(mocks.query).toHaveBeenLastCalledWith("COMMIT");
  });
});
