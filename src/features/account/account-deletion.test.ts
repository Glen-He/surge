import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  query: vi.fn(),
  remove: vi.fn(async () => {}),
  restore: vi.fn(async () => {}),
}));

vi.mock("@/infrastructure/database/client", () => ({
  db: { query: vi.fn(), connect: vi.fn() },
  withStorageLocks: vi.fn(
    async (_userId: string, fn: (client: { query: typeof mocked.query }) => unknown) =>
      fn({ query: mocked.query }),
  ),
}));

vi.mock("@/features/reports/storage/report-storage", () => ({
  moveUserDirToTrash: vi.fn(async () => ({
    original: "/reports/user-1",
    trashed: "/reports/.trash/one.data",
    manifest: "/reports/.trash/one.json",
  })),
  removeTrashedDir: mocked.remove,
  restoreTrashedDir: mocked.restore,
}));

import { deleteUserPermanently } from "@/features/account/account-deletion";

describe("账号物理删除", () => {
  beforeEach(() => {
    mocked.query.mockReset();
    mocked.remove.mockClear();
    mocked.restore.mockClear();
  });

  it("在删除账号的同一事务中清除按邮箱保存的个人数据", async () => {
    mocked.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT email FROM")) {
        return { rows: [{ email: "person@example.test" }], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM "user"')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteUserPermanently("user-1", "guest")).resolves.toBe(true);
    const sql = mocked.query.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("DELETE FROM security_logs");
    expect(sql).toContain("DELETE FROM otp_codes");
    expect(sql).toContain("DELETE FROM verification");
    expect(sql.indexOf("DELETE FROM security_logs")).toBeLessThan(
      sql.indexOf('DELETE FROM "user"'),
    );
    expect(sql).toContain("COMMIT");
    expect(mocked.remove).toHaveBeenCalledOnce();
    expect(mocked.restore).not.toHaveBeenCalled();
  });

  it("删除资格已失效时回滚并恢复用户目录", async () => {
    mocked.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT email FROM")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteUserPermanently("user-1", "account")).resolves.toBe(false);
    expect(mocked.restore).toHaveBeenCalledOnce();
    expect(mocked.remove).not.toHaveBeenCalled();
  });
});
