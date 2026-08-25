import { MAX_ZIP_BYTES } from "./storage-limits";

// Multipart headers and metadata are tiny compared with the file. Keeping a
// bounded allowance lets the app reject oversized bodies before formData()
// allocates them in memory.
export const MAX_MULTIPART_BYTES = MAX_ZIP_BYTES + 1024 * 1024;

export async function readUploadForm(
  req: Request,
): Promise<{ ok: true; form: FormData } | { ok: false; response: Response }> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    return {
      ok: false,
      response: Response.json(
        { error: "请求体必须是 multipart 表单" },
        { status: 415 },
      ),
    };
  }
  const rawLength = req.headers.get("content-length");
  const length = rawLength ? Number(rawLength) : NaN;
  if (!Number.isSafeInteger(length) || length < 0) {
    return {
      ok: false,
      response: Response.json(
        { error: "上传请求必须包含有效的 Content-Length" },
        { status: 411 },
      ),
    };
  }
  if (length > MAX_MULTIPART_BYTES) {
    return {
      ok: false,
      response: Response.json({ error: "上传请求超过 51MB 上限" }, { status: 413 }),
    };
  }
  try {
    return { ok: true, form: await req.formData() };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "multipart 表单无效" }, { status: 400 }),
    };
  }
}
