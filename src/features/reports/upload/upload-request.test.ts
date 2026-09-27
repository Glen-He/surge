import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/reports/upload/upload-gate", () => ({
  tryAcquireUploadLease: vi.fn(async () => ({ release: vi.fn(async () => {}) })),
}));
import { MAX_MULTIPART_BYTES, readUploadForm } from "@/features/reports/upload/upload-request";
import { tryAcquireUploadLease } from "./upload-gate";
import { uploadFailureResponse } from "@/features/reports/upload/upload-errors";

describe("readUploadForm", () => {
  async function fileRequest() {
    const form = new FormData();
    form.set("title", "report");
    form.set("file", new Blob(["<html>report</html>"], { type: "text/html" }), "report.html");
    const encoded = new Request("http://local/upload", { method: "POST", body: form });
    const body = await encoded.arrayBuffer();
    return new Request(encoded.url, { method: "POST", body, headers: {
      "content-type": encoded.headers.get("content-type")!, "content-length": String(body.byteLength),
    } });
  }

  it("真实文件才取得租约，成功后清理文件并释放", async () => {
    const release = vi.fn(async () => {});
    vi.mocked(tryAcquireUploadLease).mockResolvedValueOnce({ release });
    const result = await readUploadForm(await fileRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.file?.size).toBe(19);
    expect(release).not.toHaveBeenCalled();
    await result.value.cleanup();
    expect(release).toHaveBeenCalledOnce();
  });

  it("文件租约繁忙时及时拒绝，不悬挂解析流", async () => {
    vi.mocked(tryAcquireUploadLease).mockResolvedValueOnce(null);
    expect(await readUploadForm(await fileRequest())).toMatchObject({ ok: false, code: "UPLOAD_BUSY" });
  });

  it("在解析前拒绝错误类型、缺失长度和超限请求", async () => {
    const wrongType = await readUploadForm(
      new Request("http://local/upload", { method: "POST", body: "x" }),
    );
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(uploadFailureResponse(wrongType).status).toBe(415);

    const noLength = await readUploadForm(
      new Request("http://local/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
      }),
    );
    expect(noLength.ok).toBe(false);
    if (!noLength.ok) expect(uploadFailureResponse(noLength).status).toBe(411);

    const tooLarge = await readUploadForm(
      new Request("http://local/upload", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(MAX_MULTIPART_BYTES + 1),
        },
      }),
    );
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(uploadFailureResponse(tooLarge).status).toBe(413);
  });

  it("解析有效 multipart 表单", async () => {
    vi.mocked(tryAcquireUploadLease).mockClear();
    const boundary = "surge-test-boundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      "",
      "Weekly report",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const result = await readUploadForm(
      new Request("http://local/upload", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(Buffer.byteLength(body)),
        },
        body,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.form.get("title")).toBe("Weekly report");
      expect(tryAcquireUploadLease).not.toHaveBeenCalled();
      await result.value.cleanup();
    }
  });
});
