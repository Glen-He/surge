import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import unzipper from "unzipper";
import {
  UploadError,
  type UploadErrorArgs,
  type UploadErrorCode,
} from "./upload-errors";

export interface UnzipLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxDepth: number;
}

export interface UnzipResult {
  fileCount: number;
  totalBytes: number;
}

/** 解压安全限制错误：携带错误码与参数，用户文案由边界层翻译 */
type ZipUploadErrorCode = Extract<UploadErrorCode, `ZIP_${string}`>;

export class UnzipLimitError<
  C extends ZipUploadErrorCode = ZipUploadErrorCode,
> extends UploadError<C> {
  constructor(code: C, ...args: UploadErrorArgs<C>) {
    super(code, ...args);
  }
}

const DEFAULT_LIMITS: UnzipLimits = {
  maxFiles: 50,
  maxTotalBytes: 100 * 1024 * 1024,
  maxDepth: 5,
};

function mb(n: number): string {
  return `${Math.round(n / (1024 * 1024))}MB`;
}

function safeRelative(raw: string, maxDepth: number): string {
  if (!raw || raw.includes("\0")) {
    throw new UnzipLimitError("ZIP_EMPTY_PATH");
  }
  const portable = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = portable.split("/");
  if (
    portable.startsWith("/") ||
    /^[A-Za-z]:/.test(portable) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new UnzipLimitError("ZIP_PATH_INVALID", { path: raw });
  }
  const depth = segments.length - 1;
  if (depth > maxDepth) {
    throw new UnzipLimitError("ZIP_DEPTH_EXCEEDED", { max: maxDepth, path: raw });
  }
  return segments.join(path.sep);
}

function assertRegularFile(file: unzipper.File): void {
  const sys = file.versionMadeBy >>> 8;
  if (sys !== 3) return;
  const ifmt = (file.externalFileAttributes >>> 16) & 0xf000;
  if (ifmt === 0xa000) {
    throw new UnzipLimitError("ZIP_SYMLINK", { path: file.path });
  }
  if (ifmt !== 0 && ifmt !== 0x8000 && ifmt !== 0x4000) {
    throw new UnzipLimitError("ZIP_SPECIAL_FILE", {
      mode: ifmt.toString(8),
      path: file.path,
    });
  }
}

/**
 * 安全解压（带背压）：先校验并累计中央目录声明的条目信息，再顺序流式落盘。
 * 所有条目共享同一字节计数器，伪造头也无法突破实时上限，且无条目滞留内存。
 */
export async function unzipStream(
  archivePath: string,
  dest: string,
  limits: Partial<UnzipLimits> = {},
): Promise<UnzipResult> {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const directory = await unzipper.Open.file(archivePath);
  const names = new Set<string>();
  let declaredTotal = 0;
  let declaredFiles = 0;

  for (const file of directory.files) {
    assertRegularFile(file);
    if (file.type === "Directory") continue;
    const rel = safeRelative(file.path, L.maxDepth);
    const collisionKey = rel.toLocaleLowerCase("en-US");
    if (names.has(collisionKey)) {
      throw new UnzipLimitError("ZIP_DUPLICATE_PATH", { path: file.path });
    }
    names.add(collisionKey);
    declaredFiles += 1;
    if (declaredFiles > L.maxFiles) {
      throw new UnzipLimitError("ZIP_FILE_COUNT", { max: L.maxFiles });
    }
    if (!Number.isSafeInteger(file.uncompressedSize) || file.uncompressedSize < 0) {
      throw new UnzipLimitError("ZIP_SIZE_INVALID", { path: file.path });
    }
    declaredTotal += file.uncompressedSize;
    if (declaredTotal > L.maxTotalBytes) {
      throw new UnzipLimitError("ZIP_TOTAL_SIZE", { max: mb(L.maxTotalBytes) });
    }
  }

  await fs.mkdir(dest, { recursive: true });
  const parser = createReadStream(archivePath).pipe(
    unzipper.Parse({ forceStream: true }),
  ) as AsyncIterable<unzipper.Entry>;
  let total = 0;
  let count = 0;

  for await (const entry of parser) {
    if (entry.type === "Directory") {
      await entry.autodrain().promise();
      continue;
    }
    if (entry.type !== "File") {
      entry.autodrain();
      throw new UnzipLimitError("ZIP_ENTRY_TYPE", { path: entry.path });
    }
    const rel = safeRelative(entry.path, L.maxDepth);
    count += 1;
    if (count > L.maxFiles) {
      entry.autodrain();
      throw new UnzipLimitError("ZIP_FILE_COUNT", { max: L.maxFiles });
    }
    const out = path.resolve(dest, rel);
    const root = path.resolve(dest);
    if (!out.startsWith(root + path.sep)) {
      entry.autodrain();
      throw new UnzipLimitError("ZIP_PATH_ESCAPE", { path: entry.path });
    }
    await fs.mkdir(path.dirname(out), { recursive: true });
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        if (total > L.maxTotalBytes) {
          callback(new UnzipLimitError("ZIP_TOTAL_SIZE", { max: mb(L.maxTotalBytes) }));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(entry, limiter, createWriteStream(out, { flags: "wx" }));
  }

  return { fileCount: count, totalBytes: total };
}
