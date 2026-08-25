import { Readable } from "stream";
import { promises as fs } from "fs";
import path from "path";
import unzipper from "unzipper";

export interface UnzipLimits {
  /** 文件数量上限 */
  maxFiles: number;
  /** 所有文件解压后累计大小上限（字节）——同时是单 entry 缓冲上限 */
  maxTotalBytes: number;
  /** 目录深度上限（路径中的目录层数） */
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

// 安全解压：拒绝路径穿越；限制文件数 / 目录深度 / 解压后累计大小。
// header 声明值先行拦截 + 实际写入复核，超限即失败，调用方负责清理目标目录。
export async function unzipStream(
  buf: Buffer,
  dest: string,
  limits: Partial<UnzipLimits> = {},
): Promise<UnzipResult> {
  const L = { ...DEFAULT_LIMITS, ...limits };

  // ── 第一道：central directory 预检（symlink / 特殊文件类型）──
  // unzipper.Parse 只读 local file header，其中不含 unix mode（entry.type
  // 永远只有 File/Directory），symlink 信息只存在于 central directory 的
  // external attributes。先整体扫描一遍元数据，硬链接/fifo/socket/设备文件
  // 与 symlink 一律拒绝（zip 内 symlink 可指向宿主任意路径，是经典逃逸向量）。
  // 注：python zipfile 等工具写 zip 时不带 S_IFMT 位（ifmt=0），按普通文件放行。
  const directory = await unzipper.Open.buffer(buf);
  for (const f of directory.files) {
    const sys = f.versionMadeBy >>> 8; // 高字节 = 创建系统（3 = UNIX）
    if (sys !== 3) continue; // 非 UNIX 系统（如 Windows）无 unix mode
    const ifmt = (f.externalFileAttributes >>> 16) & 0xf000; // S_IFMT
    if (ifmt === 0xa000) {
      throw new UnzipLimitError(`检测到符号链接，已拒绝：${f.path}`);
    }
    if (ifmt !== 0 && ifmt !== 0x8000 && ifmt !== 0x4000) {
      throw new UnzipLimitError(
        `不允许的特殊文件类型（0o${ifmt.toString(8)}），已拒绝：${f.path}`,
      );
    }
  }

  const stream = Readable.from([buf]);
  const writes: Array<Promise<void>> = [];
  let count = 0;
  let total = 0;
  let failure: Error | null = null;

  await new Promise<void>((resolve, reject) => {
    stream
      .pipe(unzipper.Parse())
      .on("entry", (entry) => {
        // 已失败：后续 entry 只排空，不再写入
        if (failure) {
          entry.autodrain();
          return;
        }
        // Zip Slip 防护（relative 校验，杜绝 /a/b 与 /a/bc 前缀误判）：
        // 解析后的绝对路径必须严格落在 dest 内
        const full = path.resolve(dest, entry.path);
        const rel = path.relative(path.resolve(dest), full);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          failure = new UnzipLimitError(
            `检测到非法路径（试图逃逸项目目录）：${entry.path}`,
          );
          entry.autodrain();
          return;
        }
        // 目录 entry 跳过：真实目录由写入时的 mkdir recursive 创建
        if (entry.type === "Directory") {
          entry.autodrain();
          return;
        }
        // 只允许普通文件：symlink / hardlink / 设备文件等一律拒绝
        //（zip 内 symlink 可指向宿主任意路径，是经典逃逸向量）
        if (entry.type !== "File") {
          failure = new UnzipLimitError(
            `不允许的文件类型（${entry.type}）：${entry.path}`,
          );
          entry.autodrain();
          return;
        }
        count++;
        if (count > L.maxFiles) {
          failure = new UnzipLimitError(`文件数量超过 ${L.maxFiles} 个上限`);
          entry.autodrain();
          return;
        }
        // 目录深度：相对路径中 "/" 的个数（a/b/c.txt = 1 层）
        const depth = entry.path.split("/").length - 1;
        if (depth > L.maxDepth) {
          failure = new UnzipLimitError(
            `目录深度超过 ${L.maxDepth} 层上限：${entry.path}`,
          );
          entry.autodrain();
          return;
        }
        // zip header 声明大小先行拦截：累计声明值已超总预算即失败
        const declared = Number(entry.size ?? 0);
        if (total + declared > L.maxTotalBytes) {
          failure = new UnzipLimitError(
            `解压后总大小超过 ${mb(L.maxTotalBytes)} 上限`,
          );
          entry.autodrain();
          return;
        }
        const p = entry
          // entry 级缓冲上限 = 总预算：实际数据超过声明时在此截断
          .buffer(L.maxTotalBytes)
          .then(async (b: Buffer) => {
            total += b.length;
            if (total > L.maxTotalBytes) {
              throw new UnzipLimitError(
                `解压后总大小超过 ${mb(L.maxTotalBytes)} 上限`,
              );
            }
            const out = path.join(dest, rel);
            await fs.mkdir(path.dirname(out), { recursive: true });
            await fs.writeFile(out, b);
          });
        // 写入错误汇入 failure，最终让整体失败（不再静默吞掉）
        p.catch((e: unknown) => {
          if (!failure) {
            failure =
              e instanceof UnzipLimitError
                ? e
                : new Error("zip 解压失败");
          }
        });
        writes.push(p.catch(() => {}));
      })
      .on("close", () => (failure ? reject(failure) : resolve()))
      .on("error", reject);
  });

  await Promise.all(writes);
  return { fileCount: count, totalBytes: total };
}
