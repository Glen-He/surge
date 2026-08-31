import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { UnzipLimitError, unzipStream } from "@/lib/zip";

type ZipEntry = { name: string; data: string; mode?: number };
const tempDirs: string[] = [];

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 最小 stored（无压缩）ZIP 写入器：仅测试用，避免为解压测试引入写入依赖 */
function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surge-zip-test-"));
  tempDirs.push(dir);
  return dir;
}

async function archiveFile(content: Buffer): Promise<string> {
  const dir = await tempDir();
  const file = path.join(dir, "archive.zip");
  await fs.writeFile(file, content);
  return file;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("unzipStream", () => {
  it("按顺序解压并返回实际字节数", async () => {
    const dest = await tempDir();
    const result = await unzipStream(
      await archiveFile(makeZip([
        { name: "report.html", data: "<h1>ok</h1>" },
        { name: "assets/data.js", data: "window.x = 1" },
      ])),
      dest,
    );
    expect(result).toEqual({ fileCount: 2, totalBytes: 23 });
    expect(await fs.readFile(path.join(dest, "report.html"), "utf8")).toBe(
      "<h1>ok</h1>",
    );
  });

  it.each(["../escape.txt", "/absolute.txt", "C:/drive.txt", "a/./b.txt"])(
    "拒绝非安全路径 %s",
    async (name) => {
      await expect(
        unzipStream(await archiveFile(makeZip([{ name, data: "x" }])), await tempDir()),
      ).rejects.toBeInstanceOf(UnzipLimitError);
    },
  );

  it("拒绝大小写折叠后的重复路径", async () => {
    await expect(
      unzipStream(
        await archiveFile(makeZip([
          { name: "Report.html", data: "a" },
          { name: "report.html", data: "b" },
        ])),
        await tempDir(),
      ),
    ).rejects.toMatchObject({ code: "ZIP_DUPLICATE_PATH" });
  });

  it("在写入前拒绝文件数和总大小超限", async () => {
    const zip = makeZip([
      { name: "report.html", data: "12345" },
      { name: "data.js", data: "67890" },
    ]);
    await expect(
      unzipStream(await archiveFile(zip), await tempDir(), { maxFiles: 1 }),
    ).rejects.toMatchObject({ code: "ZIP_FILE_COUNT" });
    await expect(
      unzipStream(await archiveFile(zip), await tempDir(), { maxTotalBytes: 9 }),
    ).rejects.toMatchObject({ code: "ZIP_TOTAL_SIZE" });
  });

  it("拒绝 Unix 符号链接条目", async () => {
    await expect(
      unzipStream(
        await archiveFile(makeZip([{ name: "link", data: "report.html", mode: 0o120777 }])),
        await tempDir(),
      ),
    ).rejects.toMatchObject({ code: "ZIP_SYMLINK" });
  });
});
