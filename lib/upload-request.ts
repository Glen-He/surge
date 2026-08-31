import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { MAX_ZIP_BYTES } from "./storage-limits";
import {
  ensureStorageHeadroom,
  StorageCapacityError,
} from "./storage-capacity";
import { tryAcquireUploadLease } from "./upload-gate";

// Multipart headers and metadata are tiny compared with the file. The reverse
// proxy should enforce the same bound; this check rejects oversized requests
// before any body bytes are consumed by the application.
export const MAX_MULTIPART_BYTES = MAX_ZIP_BYTES + 1024 * 1024;

const MAX_FIELD_BYTES = 8 * 1024;
const MAX_FIELDS = 8;

export type StagedUpload = {
  name: string;
  type: string;
  path: string;
  size: number;
};

export type ParsedUploadForm = {
  form: FormData;
  file: StagedUpload | null;
  cleanup: () => Promise<void>;
};

type UploadParseResult =
  | { ok: true; value: ParsedUploadForm }
  | { ok: false; response: Response };

function failure(error: string, status: number): UploadParseResult {
  return { ok: false, response: Response.json({ error }, { status }) };
}

/**
 * Stream a bounded multipart upload into a private OS temporary directory.
 * Only the small metadata fields are retained in memory; the report payload is
 * represented by a path and must be removed by calling `cleanup()`.
 */
export async function readUploadForm(req: Request): Promise<UploadParseResult> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    return failure("请求体必须是 multipart 表单", 415);
  }

  const rawLength = req.headers.get("content-length");
  const length = rawLength ? Number(rawLength) : NaN;
  if (!Number.isSafeInteger(length) || length < 0) {
    return failure("上传请求必须包含有效的 Content-Length", 411);
  }
  if (length > MAX_MULTIPART_BYTES) {
    return failure("上传请求超过 51MB 上限", 413);
  }
  if (!req.body) return failure("multipart 表单无效", 400);

  let lease: Awaited<ReturnType<typeof tryAcquireUploadLease>>;
  try {
    lease = await tryAcquireUploadLease();
  } catch {
    return failure("上传服务暂时不可用，请稍后重试", 503);
  }
  if (!lease) return failure("当前上传任务较多，请稍后重试", 503);

  let tempDir: string;
  try {
    await ensureStorageHeadroom(tmpdir(), length);
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "surge-upload-"));
  } catch (error) {
    await lease.release();
    if (error instanceof StorageCapacityError) {
      return failure(error.message, 507);
    }
    return failure("无法创建上传暂存目录，请稍后重试", 503);
  }
  // Cleanup is best-effort: a transient filesystem cleanup failure must not
  // replace an otherwise successful upload response with a 500.
  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await lease.release();
  };
  const form = new FormData();
  let staged: StagedUpload | null = null;
  let parseError: Error | null = null;
  const writes: Promise<void>[] = [];

  try {
    const parser = Busboy({
      headers: Object.fromEntries(req.headers.entries()),
      limits: {
        files: 1,
        fields: MAX_FIELDS,
        fieldSize: MAX_FIELD_BYTES,
        fileSize: MAX_ZIP_BYTES,
        parts: MAX_FIELDS + 1,
      },
    });

    parser.on("field", (name, value, info) => {
      if (info.valueTruncated) {
        parseError = new Error("表单字段过长");
        return;
      }
      form.set(name, value);
    });

    parser.on("file", (name, stream, info) => {
      if (name !== "file" || staged) {
        parseError = new Error("只允许一个 file 字段");
        stream.resume();
        return;
      }
      const filePath = path.join(tempDir, "payload");
      staged = {
        name: path.basename(info.filename || "upload.bin"),
        type: info.mimeType || "application/octet-stream",
        path: filePath,
        size: 0,
      };
      stream.on("data", (chunk: Buffer) => {
        if (staged) staged.size += chunk.length;
      });
      stream.on("limit", () => {
        parseError = new Error("文件超过 50MB 上限");
      });
      writes.push(
        pipeline(stream, createWriteStream(filePath, { flags: "wx", mode: 0o600 })),
      );
    });

    parser.on("filesLimit", () => {
      parseError = new Error("只允许上传一个文件");
    });
    parser.on("fieldsLimit", () => {
      parseError = new Error("表单字段过多");
    });
    parser.on("partsLimit", () => {
      parseError = new Error("表单内容过多");
    });

    const source = Readable.fromWeb(
      req.body as import("node:stream/web").ReadableStream,
    );
    await pipeline(source, parser);
    await Promise.all(writes);
    if (parseError) throw parseError;

    return { ok: true, value: { form, file: staged, cleanup } };
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : "";
    if (message.includes("50MB")) return failure(message, 413);
    return failure(message || "multipart 表单无效", 400);
  }
}
