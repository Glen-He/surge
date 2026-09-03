import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getApiSession: vi.fn(),
  getReportsByUser: vi.fn(),
  reorderReports: vi.fn(),
}));

vi.mock("@/features/auth/api-session", () => ({
  getApiSession: mocked.getApiSession,
}));

vi.mock("@/features/reports/data/reports-db", () => ({
  getReportsByUser: mocked.getReportsByUser,
  reorderReports: mocked.reorderReports,
}));

import { POST } from "@/app/api/reports/reorder/route";

const current = [
  { slug: "a", date: "2026-09-01" },
  { slug: "b", date: "2026-09-01" },
  { slug: "c", date: "2026-08-31" },
];

function request(items: unknown, baseItems: unknown) {
  return new Request("https://surge.example/api/reports/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, baseItems }),
  });
}

describe("报告排序 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getApiSession.mockResolvedValue({ user: { id: "user-1" } });
    mocked.getReportsByUser.mockResolvedValue(current);
    mocked.reorderReports.mockResolvedValue("updated");
  });

  it("同时提交基础顺序和目标顺序", async () => {
    const next = [current[1], current[0], current[2]];
    const response = await POST(request(next, current));

    expect(response.status).toBe(200);
    expect(mocked.reorderReports).toHaveBeenCalledWith(
      "user-1",
      next,
      current,
    );
  });

  it("拒绝缺少基础顺序的旧客户端请求", async () => {
    const response = await POST(request(current, undefined));

    expect(response.status).toBe(400);
    expect(mocked.reorderReports).not.toHaveBeenCalled();
  });

  it("过期写入返回服务器标准顺序", async () => {
    mocked.reorderReports.mockResolvedValue("stale");
    const response = await POST(request([current[1], current[0], current[2]], current));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "项目列表已发生变化，请刷新后重试",
      items: current,
    });
  });
});
