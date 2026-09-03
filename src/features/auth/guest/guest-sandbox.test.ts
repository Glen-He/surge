import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/infrastructure/database/client", () => ({
  db: {
    connect: vi.fn(async () => ({
      query: mocked.query,
      release: mocked.release,
    })),
  },
}));
vi.mock("@/features/account/account-deletion", () => ({
  deleteUserPermanently: vi.fn(async () => true),
}));

import {
  DEMO_TEMPLATES,
  guestInternalProof,
  initializeGuestSandbox,
  verifyGuestInternalProof,
} from "@/features/auth/guest/guest-sandbox";

describe("游客共享模板沙箱", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT expires_at")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
  });

  it("内部游客编排证明拒绝篡改", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "guest-proof-test-secret-at-least-32-chars");
    const proof = guestInternalProof();
    expect(verifyGuestInternalProof(proof)).toBe(true);
    const tampered = `${proof.slice(0, -1)}${proof.endsWith("0") ? "1" : "0"}`;
    expect(verifyGuestInternalProof(tampered)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("在一个事务中创建租约与五个独立模板引用", async () => {
    const expiresAt = await initializeGuestSandbox("guest-1", 60);
    const reportInsert = mocked.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO reports"),
    );

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mocked.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT expires_at"),
      expect.stringContaining("INSERT INTO guest_sessions"),
      expect.stringContaining("INSERT INTO reports"),
      "COMMIT",
    ]);
    expect(String(reportInsert?.[0])).toContain("template_key");
    expect(reportInsert?.[1]).toHaveLength(DEMO_TEMPLATES.length * 12);
    for (const template of DEMO_TEMPLATES) {
      expect(reportInsert?.[1]).toContain(template.tplDir);
    }
    expect(mocked.release).toHaveBeenCalledOnce();
  });

  it("写入报告失败时回滚整个初始化", async () => {
    mocked.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT expires_at")) return { rows: [] };
      if (sql.includes("INSERT INTO reports")) throw new Error("write failed");
      return { rows: [], rowCount: 1 };
    });

    await expect(initializeGuestSandbox("guest-2", 60)).rejects.toThrow(
      "write failed",
    );
    expect(mocked.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocked.release).toHaveBeenCalledOnce();
  });
});
