import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/infrastructure/database/client", () => ({ db: { connect: mocks.connect } }));
import { createReportShare } from "./report-share";

describe("分享创建身份策略", () => {
  it("业务入口直接拒绝游客，不依赖 HTTP 路由提前检查", async () => {
    await expect(createReportShare({ userId: "guest", userEmail: "guest@demo.surge", slug: "report", passwordProtected: true })).rejects.toMatchObject({ code: "SHARE_GUEST_FORBIDDEN" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
