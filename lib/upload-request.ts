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
import {
  uploadFailure,
  UploadError,
  type UploadFailure,
} from "./upload-errors";

// multipart 头部与元信息相对文件体很小。反向代理应执行同样的上限；
// 这里在应用消费任何 body 字节前先拒绝超限请求。
export const MAX_MULTIPART_BYTES = MAX_ZIP_BYTES + 1024 * 1024;

const MAX_FIELD_BYTES = 8 * 1024;
const MAX_FIELDS = 8;

type StagedUpload = {
  name: string;
  type: string;
  path: string;
  size: number;
};

type ParsedUploadForm = {
  form: FormData;
  file: StagedUpload | null;
  cleanup: () => Promise<void>;
};

type UploadParseResult =
  | { ok: true; value: ParsedUploadForm }
  | UploadFailure;

/**
 * 将受限大小的 multipart 上传流式落盘到操作系统私有临时目录。
 * 仅小的元信息字段保留在内存；报告文件以路径表示，用完必须调用 `cleanup()` 清理。
 */
export async function readUploadForm(req: Request): Promise<UploadParseResult> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    return uploadFailure("FORM_NOT_MULTIPART");
  }

  const rawLength = req.headers.get("content-length");
  const length = rawLength ? Number(rawLength) : NaN;
  if (!Number.isSafeInteger(length) || length < 0) {
    return uploadFailure("FORM_LENGTH_REQUIRED");
  }
  if (length > MAX_MULTIPART_BYTES) {
    return uploadFailure(
      "FORM_MULTIPART_TOO_LARGE",
      {
        max: Math.round(MAX_MULTIPART_BYTES / 1024 / 1024),
      },
    );
  }
  if (!req.body) return uploadFailure("FORM_INVALID");

  let lease: Awaited<ReturnType<typeof tryAcquireUploadLease>>;
  try {
    lease = await tryAcquireUploadLease();
  } catch {
    return uploadFailure("UPLOAD_UNAVAILABLE");
  }
  if (!lease) return uploadFailure("UPLOAD_BUSY");

  let tempDir: string;
  try {
    await ensureStorageHeadroom(tmpdir(), length);
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "surge-upload-"));
  } catch (error) {
    await lease.release();
    if (error instanceof StorageCapacityError) {
      return error.toFailure();
    }
    return uploadFailure("FORM_STAGING_FAILED");
  }
  // 清理是尽力而为：临时目录清理的偶发失败不应把本已成功的上传响应变成 500。
  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await lease.release();
  };
  const form = new FormData();
  let staged: StagedUpload | null = null;
  let parseError: UploadError | null = null;
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
        parseError = new UploadError("FORM_FIELD_TOO_LONG");
        return;
      }
      form.set(name, value);
    });

    parser.on("file", (name, stream, info) => {
      if (name !== "file" || staged) {
        parseError = new UploadError("FORM_SINGLE_FILE_FIELD");
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
        parseError = new UploadError("FORM_FILE_TOO_LARGE", {
          max: Math.round(MAX_ZIP_BYTES / 1024 / 1024),
        });
      });
      writes.push(
        pipeline(stream, createWriteStream(filePath, { flags: "wx", mode: 0o600 })),
      );
    });

    parser.on("filesLimit", () => {
      parseError = new UploadError("FORM_FILES_LIMIT");
    });
    parser.on("fieldsLimit", () => {
      parseError = new UploadError("FORM_FIELDS_LIMIT");
    });
    parser.on("partsLimit", () => {
      parseError = new UploadError("FORM_PARTS_LIMIT");
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
    // 仅透传结构化解析拒绝；其余内部异常一律走通用错误码，避免泄漏
    // 内部 error.message。中文文案由 Route Handler 统一生成。
    if (error instanceof UploadError) {
      return error.toFailure();
    }
    return uploadFailure("FORM_INVALID");
  }
}
