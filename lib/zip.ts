import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import unzipper from "unzipper";

export interface UnzipLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxDepth: number;
}

export interface UnzipResult {
  fileCount: number;
  totalBytes: number;
}

export class UnzipLimitError extends Error {}

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
    throw new UnzipLimitError("压缩包包含空路径或 NUL 字符");
  }
  const portable = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = portable.split("/");
  if (
    portable.startsWith("/") ||
    /^[A-Za-z]:/.test(portable) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new UnzipLimitError(`检测到非法路径：${raw}`);
  }
  const depth = segments.length - 1;
  if (depth > maxDepth) {
    throw new UnzipLimitError(`目录深度超过 ${maxDepth} 层上限：${raw}`);
  }
  return segments.join(path.sep);
}

function assertRegularFile(file: unzipper.File): void {
  const sys = file.versionMadeBy >>> 8;
  if (sys !== 3) return;
  const ifmt = (file.externalFileAttributes >>> 16) & 0xf000;
  if (ifmt === 0xa000) {
    throw new UnzipLimitError(`检测到符号链接，已拒绝：${file.path}`);
  }
  if (ifmt !== 0 && ifmt !== 0x8000 && ifmt !== 0x4000) {
    throw new UnzipLimitError(
      `不允许的特殊文件类型（0o${ifmt.toString(8)}），已拒绝：${file.path}`,
    );
  }
}

/**
 * Safe, backpressured extraction.
 *
 * The central directory is validated and summed before any write. Entries are
 * then streamed sequentially through one shared byte counter, so lying headers
 * cannot exceed the live cap and no entry is buffered in memory.
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
      throw new UnzipLimitError(`压缩包包含重复文件路径：${file.path}`);
    }
    names.add(collisionKey);
    declaredFiles += 1;
    if (declaredFiles > L.maxFiles) {
      throw new UnzipLimitError(`文件数量超过 ${L.maxFiles} 个上限`);
    }
    if (!Number.isSafeInteger(file.uncompressedSize) || file.uncompressedSize < 0) {
      throw new UnzipLimitError(`文件大小声明非法：${file.path}`);
    }
    declaredTotal += file.uncompressedSize;
    if (declaredTotal > L.maxTotalBytes) {
      throw new UnzipLimitError(
        `解压后总大小超过 ${mb(L.maxTotalBytes)} 上限`,
      );
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
      throw new UnzipLimitError(`不允许的文件类型：${entry.path}`);
    }
    const rel = safeRelative(entry.path, L.maxDepth);
    count += 1;
    if (count > L.maxFiles) {
      entry.autodrain();
      throw new UnzipLimitError(`文件数量超过 ${L.maxFiles} 个上限`);
    }
    const out = path.resolve(dest, rel);
    const root = path.resolve(dest);
    if (!out.startsWith(root + path.sep)) {
      entry.autodrain();
      throw new UnzipLimitError(`检测到路径逃逸：${entry.path}`);
    }
    await fs.mkdir(path.dirname(out), { recursive: true });
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        if (total > L.maxTotalBytes) {
          callback(
            new UnzipLimitError(
              `解压后总大小超过 ${mb(L.maxTotalBytes)} 上限`,
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(entry, limiter, createWriteStream(out, { flags: "wx" }));
  }

  return { fileCount: count, totalBytes: total };
}
