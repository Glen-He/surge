import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "node:path";
import { createHash } from "node:crypto";

// ── 平台资源 manifest 完整性校验单测 ──
//
// 校验逻辑见 lib/platform-assets.ts 的 validatePlatformManifest：
// schema（fileName 为内嵌登记 hash 的简单文件名 / 16 位 hex /
// contentType 白名单 / entry 字段形状）+ 磁盘文件名与 fileName 一致 +
// 真实 sha256 前 16 位与登记值一致。该校验在 next.config.ts（构建与
// 启动期）fail-fast，是 immutable URL 正确性的最后一道锁：文件字节变化
// 而 manifest 未更新必须直接失败。

import { validatePlatformManifest } from "@/lib/platform-assets";

const HASH = "0123456789abcdef";

function okEntry(): { fileName: string; sha256_16: string; contentType: string } {
  return {
    fileName: `lib.${HASH}.min.js`,
    sha256_16: HASH,
    contentType: "text/javascript; charset=utf-8",
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "surge-platform-assets-"));
}

async function writeManifest(
  dir: string,
  manifest: unknown,
  files: Record<string, string> = {},
): Promise<void> {
  await writeFile(path.join(dir, "platform-manifest.json"), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) {
    // 非法 fileName 的用例不落盘文件：schema 校验在读文件前就会拒绝
    if (name.includes("/")) continue;
    await writeFile(path.join(dir, name), content);
  }
}

function hash16(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

describe("平台资源 manifest 完整性校验", () => {
  it("登记一致时校验通过", async () => {
    const dir = await tempDir();
    try {
      const content = "console.log('platform lib')";
      const entry = { ...okEntry(), sha256_16: hash16(content), fileName: `lib.${hash16(content)}.min.js` };
      await writeManifest(dir, { lib: entry }, { [entry.fileName]: content });
      expect(() => validatePlatformManifest(dir)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("文件字节与登记 hash 不一致时失败（immutable URL 不变量）", async () => {
    const dir = await tempDir();
    try {
      await writeManifest(
        dir,
        { lib: okEntry() },
        { [okEntry().fileName]: "new bytes after silent upgrade" },
      );
      expect(() => validatePlatformManifest(dir)).toThrow(/content hash mismatch/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("磁盘文件名与登记 fileName 不一致（缺失）时失败", async () => {
    const dir = await tempDir();
    try {
      await writeManifest(dir, { lib: okEntry() });
      expect(() => validatePlatformManifest(dir)).toThrow(/registered file is unreadable/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("manifest 缺失 / 非法 JSON / 根不是对象时失败", async () => {
    const empty = await tempDir();
    const badJson = await tempDir();
    const badRoot = await tempDir();
    try {
      expect(() => validatePlatformManifest(empty)).toThrow(/missing or unreadable/);

      await writeFile(path.join(badJson, "platform-manifest.json"), "{oops");
      expect(() => validatePlatformManifest(badJson)).toThrow(/not valid JSON/);

      await writeFile(path.join(badRoot, "platform-manifest.json"), "[]");
      expect(() => validatePlatformManifest(badRoot)).toThrow(/root must be a JSON object/);
    } finally {
      await Promise.all(
        [empty, badJson, badRoot].map((d) => rm(d, { recursive: true, force: true })),
      );
    }
  });

  it("schema 违规：嵌套 fileName、hash 未内嵌、大小写 hash、contentType 白名单、多余字段", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ lib: { ...okEntry(), fileName: "a/b.js" } }, /plain file name/],
      // fileName 内嵌的 hash 段与登记值不同
      [
        { lib: { ...okEntry(), fileName: `lib.0000000000000000.min.js` } },
        /must embed the registered sha256_16/,
      ],
      // 文件名没有 hash 段
      [{ lib: { ...okEntry(), fileName: "lib.js" } }, /must embed the registered sha256_16/],
      // 登记值非小写 hex
      [
        { lib: { ...okEntry(), sha256_16: "0123456789ABCDEF" } },
        /16 lowercase hex/,
      ],
      [{ lib: { ...okEntry(), contentType: "text/html" } }, /allowlist/],
      [{ lib: { ...okEntry(), extra: 1 } }, /exactly fileName, sha256_16 and contentType/],
      [{ lib: { fileName: 42, sha256_16: HASH, contentType: "text/javascript; charset=utf-8" } }, /must be strings/],
    ];
    for (const [manifest, pattern] of cases) {
      const dir = await tempDir();
      try {
        await writeManifest(dir, manifest);
        expect(() => validatePlatformManifest(dir)).toThrow(pattern);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("仓库真实 manifest 与磁盘文件一致（构建期同款校验）", () => {
    expect(() => validatePlatformManifest()).not.toThrow();
  });
});
