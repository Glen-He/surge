import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

const mocked = vi.hoisted(() => {
  process.env.REPORTS_DATA_DIR = "/tmp/surge-report-upload-atomic-tests";
  return {
    query: vi.fn(),
  };
});

vi.mock("@/infrastructure/database/client", () => ({
  db: { query: vi.fn() },
  withStorageLocks: vi.fn(
    async (_userId: string, fn: (client: { query: typeof mocked.query }) => unknown) =>
      fn({ query: mocked.query }),
  ),
}));

vi.mock("@/features/auth/guest/guest-identity", () => ({
  isGuestEmail: vi.fn(() => false),
}));

import { replaceReportFile } from "@/features/reports/upload/upload-report";
import {
  REPORT_DATA_DIR,
  reportArtifactDir,
  reportArtifactsDir,
} from "@/features/reports/storage/report-storage";

describe("不可变报告替换", () => {
  const userId = "atomic-user";
  const slug = "r_atomic";
  const oldStorageKey = "a_11111111111111111111111111111111";
  const uploadPath = path.join(REPORT_DATA_DIR, "new-report.html");

  beforeEach(async () => {
    mocked.query.mockReset();
    await fs.rm(REPORT_DATA_DIR, { recursive: true, force: true });
    await fs.mkdir(reportArtifactDir(userId, oldStorageKey), { recursive: true });
    await fs.writeFile(
      path.join(reportArtifactDir(userId, oldStorageKey), "report.html"),
      "old",
    );
    await fs.writeFile(uploadPath, "new");
  });

  afterEach(async () => {
    await fs.rm(REPORT_DATA_DIR, { recursive: true, force: true });
  });

  function baseQueries(update: () => unknown) {
    mocked.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT size_bytes::text")) {
        return {
          rows: [
            {
              size_bytes: "3",
              template_key: null,
              storage_key: oldStorageKey,
              date: "2026-08-25",
              sort_order: 0,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("AS user_bytes")) {
        return { rows: [{ user_bytes: "3", site_bytes: "3" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE reports")) return update();
      throw new Error(`unexpected query: ${sql} ${JSON.stringify(params)}`);
    });
  }

  it("数据库指针切换失败时旧文件仍完整可用", async () => {
    baseQueries(() => {
      throw new Error("database unavailable");
    });

    const result = await replaceReportFile(userId, slug, {
      name: "report.html",
      type: "text/html",
      path: uploadPath,
      size: 3,
    });

    expect(result).toMatchObject({ ok: false, code: "REPLACE_FAILED" });
    await expect(
      fs.readFile(
        path.join(reportArtifactDir(userId, oldStorageKey), "report.html"),
        "utf8",
      ),
    ).resolves.toBe("old");
    await expect(fs.readdir(reportArtifactsDir(userId))).resolves.toEqual([
      oldStorageKey,
    ]);
  });

  it("成功切换后只保留数据库指向的新版本", async () => {
    let storageKey = "";
    baseQueries(() => {
      const call = mocked.query.mock.calls.at(-1);
      storageKey = String(call?.[1]?.[2]);
      return { rows: [], rowCount: 1 };
    });

    const result = await replaceReportFile(userId, slug, {
      name: "report.html",
      type: "text/html",
      path: uploadPath,
      size: 3,
    });

    expect(result.ok).toBe(true);
    await expect(
      fs.access(reportArtifactDir(userId, oldStorageKey)),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(reportArtifactDir(userId, storageKey), "report.html"), "utf8"),
    ).resolves.toBe("new");
  });
});
