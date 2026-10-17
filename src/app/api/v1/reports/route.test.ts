import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));

vi.mock("@/features/account/api-tokens", () => ({
  authenticateApiToken: mocks.authenticate,
}));

import { POST } from "./route";

describe("开放 API 令牌入口", () => {
  it("缺少有效令牌时返回 401，不读取请求体", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/v1/reports", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  });
});
