import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("@/features/maintenance/scheduler", () => ({
  runMaintenance: mocks.run,
}));

import { POST } from "./route";

function request(token = "maintenance-secret-at-least-32-chars") {
  return new Request("http://localhost/api/internal/maintenance", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("内部维护接口", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.run.mockReset();
  });

  it("拒绝错误凭证", async () => {
    vi.stubEnv("MAINTENANCE_SECRET", "maintenance-secret-at-least-32-chars");
    const response = await POST(request("wrong-secret-at-least-32-characters"));
    expect(response.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("完成任务返回 ok", async () => {
    vi.stubEnv("MAINTENANCE_SECRET", "maintenance-secret-at-least-32-chars");
    mocks.run.mockResolvedValue("ok");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("租约已被占用时返回 skipped 而不是 503", async () => {
    vi.stubEnv("MAINTENANCE_SECRET", "maintenance-secret-at-least-32-chars");
    mocks.run.mockResolvedValue("busy");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: true });
  });

  it("任务失败返回 503", async () => {
    vi.stubEnv("MAINTENANCE_SECRET", "maintenance-secret-at-least-32-chars");
    mocks.run.mockResolvedValue("failed");
    const response = await POST(request());
    expect(response.status).toBe(503);
  });
});
