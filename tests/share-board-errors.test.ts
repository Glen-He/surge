import { describe, expect, it } from "vitest";
import {
  shareBoardErrorResponse,
  ShareBoardError,
} from "@/lib/share-board-errors";

// 这些调用不执行，只由 tsc 验证 code 与 params 的绑定关系。
function verifyShareBoardErrorTypes() {
  // @ts-expect-error BOARD_LIMIT_REACHED 必须提供 max。
  new ShareBoardError("BOARD_LIMIT_REACHED");
  // @ts-expect-error BOARD_NOT_FOUND 不接受 params。
  new ShareBoardError("BOARD_NOT_FOUND", { max: 5 });
}
void verifyShareBoardErrorTypes;

describe("分享面板错误契约", () => {
  it("统一解析中文文案与 HTTP 状态", async () => {
    const error = new ShareBoardError("BOARD_LIMIT_REACHED", { max: 20 });
    const response = shareBoardErrorResponse(error);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "最多创建 20 个分享面板",
    });
  });

  it("内部异常 message 不包含业务参数或中文文案", () => {
    const error = new ShareBoardError("BOARD_ITEM_LIMIT_REACHED", { max: 50 });

    expect(error.message).toBe(
      "share board rejected: BOARD_ITEM_LIMIT_REACHED",
    );
    expect(error.message).not.toContain("50");
    expect(error.params).toEqual({ max: 50 });
  });

  it("不存在错误统一返回 404", async () => {
    const response = shareBoardErrorResponse(
      new ShareBoardError("BOARD_NOT_FOUND"),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "分享面板不存在" });
  });
});
