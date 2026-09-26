import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/infrastructure/database/client", () => ({ db: { query: mocked.query } }));

import { findValidShare } from "./report-share";
import { findPublicBoardReport, findPublicShareBoard } from "./public-share-board";
import { boardReportShareUrl } from "./board-report-url";

describe("公开分享入口", () => {
  beforeEach(() => mocked.query.mockReset());

  it.each(["a".repeat(22), "A1b2c3d4", "a1b2c3d_", "short"])("查询前拒绝非法 token %s", async (token) => {
    expect(await findValidShare(token)).toBeNull();
    expect(await findPublicShareBoard(token)).toBeNull();
    expect(await findPublicBoardReport(token, "ab12")).toBeNull();
    expect(mocked.query).not.toHaveBeenCalled();
  });

  it.each(["a".repeat(32), "AB12", "ab_2", "abc", "abcde", ""])("旧标识和非法短码 %s 在查询前拒绝", async (itemId) => {
    expect(await findPublicBoardReport("a1b2c3d4", itemId)).toBeNull();
    expect(mocked.query).not.toHaveBeenCalled();
  });

  it("分享落地页与面板查询统一使用四位短码", async () => {
    mocked.query.mockResolvedValue({ rows: [] });
    expect(boardReportShareUrl("a1b2c3d4", "ab12")).toBe("/share/a1b2c3d4?item=ab12");
    expect(await findPublicBoardReport("a1b2c3d4", "ab12")).toBeNull();
    expect(mocked.query).toHaveBeenCalledWith(expect.any(String), [expect.any(String), "ab12"]);
  });
});
