import { describe, expect, it } from "vitest";
import {
  uploadFailure,
  uploadFailureResponse,
  UploadError,
} from "@/features/reports/upload/upload-errors";
import { UnzipLimitError } from "@/features/reports/upload/zip";

// 这些调用不执行，只由 tsc 验证 code 与 params 的绑定关系。
function verifyUploadErrorTypes() {
  // @ts-expect-error ZIP_DEPTH_EXCEEDED 必须同时提供 max 与 path。
  uploadFailure("ZIP_DEPTH_EXCEEDED", { max: 5 });
  // @ts-expect-error FORM_INVALID 不接受 params。
  uploadFailure("FORM_INVALID", { max: 5 });
}
void verifyUploadErrorTypes;

describe("上传错误契约", () => {
  it("仅在响应边界生成中文文案和固定 HTTP 状态", async () => {
    const failure = uploadFailure("ZIP_DEPTH_EXCEEDED", {
      max: 5,
      path: "assets/deep/report.html",
    });
    const response = uploadFailureResponse(failure);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "目录深度超过 5 层上限：assets/deep/report.html",
    });
  });

  it("无参数错误也保持结构化结果", async () => {
    const failure = uploadFailure("REPORT_NOT_FOUND");
    expect(failure).toEqual({
      ok: false,
      code: "REPORT_NOT_FOUND",
      params: undefined,
    });
    await expect(uploadFailureResponse(failure).json()).resolves.toEqual({
      error: "项目不存在",
    });
  });

  it("异常 message 不携带用户输入，具体子类名称可用于排查", () => {
    const path = "private/user-provided/path.html";
    const error = new UnzipLimitError("ZIP_PATH_INVALID", { path });

    expect(error).toBeInstanceOf(UploadError);
    expect(error.name).toBe("UnzipLimitError");
    expect(error.message).toBe("upload rejected: ZIP_PATH_INVALID");
    expect(error.message).not.toContain(path);
    expect(error.params).toEqual({ path });
  });
});
