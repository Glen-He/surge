import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  poolQuery: vi.fn(async () => ({ rows: [], rowCount: 1 })),
  releaseClient: vi.fn(),
}));

vi.mock("@/infrastructure/database/client", () => ({
  db: {
    connect: vi.fn(async () => ({
      query: mocked.clientQuery,
      release: mocked.releaseClient,
    })),
    query: mocked.poolQuery,
  },
}));

import { tryAcquireUploadLease } from "@/features/reports/upload/upload-gate";

describe("跨实例上传租约", () => {
  beforeEach(() => {
    mocked.clientQuery.mockReset();
    mocked.poolQuery.mockClear();
    mocked.releaseClient.mockClear();
  });

  it("取得空闲槽位并在 cleanup 时立即释放", async () => {
    mocked.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("generate_series")) return { rows: [{ slot_id: 1 }] };
      return { rows: [], rowCount: 1 };
    });
    const lease = await tryAcquireUploadLease();
    expect(lease).not.toBeNull();
    expect(mocked.releaseClient).toHaveBeenCalledOnce();
    await lease!.release();
    expect(mocked.poolQuery).toHaveBeenCalledWith(
      "DELETE FROM upload_leases WHERE holder = $1",
      [expect.any(String)],
    );
  });

  it("所有槽位占用时不创建临时上传", async () => {
    mocked.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("generate_series")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    await expect(tryAcquireUploadLease()).resolves.toBeNull();
    expect(mocked.poolQuery).not.toHaveBeenCalled();
    expect(mocked.releaseClient).toHaveBeenCalledOnce();
  });
});
