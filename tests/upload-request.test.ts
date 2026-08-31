import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/upload-gate", () => ({
  tryAcquireUploadLease: vi.fn(async () => ({ release: vi.fn(async () => {}) })),
}));
import { MAX_MULTIPART_BYTES, readUploadForm } from "@/lib/upload-request";
import { uploadFailureResponse } from "@/lib/upload-errors";

describe("readUploadForm", () => {
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
      await result.value.cleanup();
    }
  });
});
