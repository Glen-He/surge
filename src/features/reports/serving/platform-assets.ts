// 平台公共资源（reports/_shared 内的平台内置库，如 echarts）登记、查找
// 与完整性校验。
//
// 本模块刻意不依赖 reports/storage/report-storage（其模块加载需要 REPORTS_DATA_DIR
// 等运行时环境）：next.config.ts 在构建期导入本模块做 fail-fast 校验，
// 必须保持零环境依赖（仅 node 内置模块）。
//
// 架构：每个登记条目的磁盘文件名、/platform/ URL 文件名与 manifest
// fileName 三者一致（文件名内嵌内容 hash，如 echarts.<sha256前16位>.min.js），
// 因此 /platform/ 的输出可以安全使用 immutable 长缓存，浏览器跨报告共享
// 同一份缓存。报告 HTML 直接引用 /platform/<fileName>；文件内容升级时
// 换新文件名并更新 manifest，URL 随内容轮换。
// 「文件名中的 hash 必须等于文件真实字节的内容 hash」由
// validatePlatformManifest 在构建/启动期强制校验（见 next.config.ts），
// 不允许每请求重算 hash。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** 平台公共资源目录（与 /r/<cap>/ 的报告内容目录分离）。 */
export const PLATFORM_SHARED_DIR = path.join(
  process.cwd(),
  "reports",
  "_shared",
);

export interface PlatformAssetEntry {
  /** 磁盘与 URL 共用的文件名，内嵌内容 hash（如 echarts.<hash>.min.js）。 */
  fileName: string;
  /** 文件内容的 sha256 十六进制前 16 位，与文件名内嵌值一致。 */
  sha256_16: string;
  /** 输出 Content-Type（manifest 决定，不按 URL 扩展名推导）。 */
  contentType: string;
}

type PlatformManifest = Record<string, PlatformAssetEntry>;

let cache: PlatformManifest | null | undefined;

// 读取失败（文件缺失/损坏）返回空表：/platform/ 对所有文件名 404。正常
// 发布不会走到这里（构建/启动期校验已 fail-fast），仅防御运行期文件被
// 意外破坏时不要把错误渲染成 500。
function manifest(): PlatformManifest {
  if (cache === undefined) {
    try {
      cache = JSON.parse(
        readFileSync(
          path.join(PLATFORM_SHARED_DIR, "platform-manifest.json"),
          "utf8",
        ),
      ) as PlatformManifest;
    } catch {
      cache = null;
    }
  }
  return cache ?? {};
}

/**
 * 按 /platform/ URL 文件名精确查找 manifest 条目；未登记的文件名一律
 * 返回 null（不存在），不输出任何内容。
 */
export function resolvePlatformAsset(
  fileName: string,
): { entry: PlatformAssetEntry } | null {
  for (const entry of Object.values(manifest())) {
    if (entry.fileName === fileName) {
      return { entry };
    }
  }
  return null;
}

// ── manifest 完整性校验（构建/启动期 fail-fast，非请求路径）──
//
// 校验三层：
// 1. schema：manifest 是普通对象；entry 只含 fileName / sha256_16 /
//    contentType 三个字符串字段；fileName 是当前目录简单文件名且内嵌
//    登记的 hash；sha256_16 匹配 16 位小写十六进制；contentType 在白名单
//    内（不扩大 /platform/ 输出类型的范围）。
// 2. 文件存在且是常规文件（磁盘文件名与 fileName 一致）。
// 3. 内容 hash：真实 sha256 前 16 位必须与登记值一致——这是 immutable
//    URL 正确性的最后一道锁，文件被替换而 manifest 未更新时直接失败。
const SHA256_16_RE = /^[0-9a-f]{16}$/;
const ALLOWED_CONTENT_TYPES = new Set([
  "text/javascript; charset=utf-8",
]);

// 文件名内嵌 hash 的唯一合法形态：<主名>.<16位hash>.<扩展名…>，
// 且 16 位 hash 段必须与登记值一致（磁盘名、URL、manifest 三者同名）。
function fileNameIssues(fileName: string, sha256_16: string): string[] {
  const issues: string[] = [];
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    path.basename(fileName) !== fileName
  ) {
    issues.push(`fileName must be a plain file name, got: ${JSON.stringify(fileName)}`);
    return issues;
  }
  const m = /^([^./]+)\.([0-9a-f]{16})(\..+)$/.exec(fileName);
  if (!m || m[2] !== sha256_16) {
    issues.push(
      `fileName must embed the registered sha256_16 as "<name>.<hash><ext>": ${JSON.stringify(fileName)}`,
    );
  }
  return issues;
}

function manifestIssues(dir: string): string[] {
  const issues: string[] = [];
  const manifestPath = path.join(dir, "platform-manifest.json");
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return [`manifest is missing or unreadable: ${manifestPath}`];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ["manifest is not valid JSON"];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return ["manifest root must be a JSON object"];
  }

  for (const [key, entry] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).some(
        (k) => k !== "fileName" && k !== "sha256_16" && k !== "contentType",
      )
    ) {
      issues.push(
        `manifest entry must be an object with exactly fileName, sha256_16 and contentType: ${key}`,
      );
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.fileName !== "string" ||
      typeof record.sha256_16 !== "string" ||
      typeof record.contentType !== "string"
    ) {
      issues.push(`manifest entry fields must be strings: ${key}`);
      continue;
    }
    issues.push(...fileNameIssues(record.fileName, record.sha256_16));
    if (!SHA256_16_RE.test(record.sha256_16)) {
      issues.push(`sha256_16 must be 16 lowercase hex chars: ${key}`);
      continue;
    }
    if (!ALLOWED_CONTENT_TYPES.has(record.contentType)) {
      issues.push(`contentType is not in the platform allowlist: ${key}`);
      continue;
    }

    const filePath = path.join(dir, record.fileName);
    let content: Buffer;
    try {
      content = readFileSync(filePath);
    } catch {
      issues.push(`registered file is unreadable: ${record.fileName}`);
      continue;
    }
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual.slice(0, 16) !== record.sha256_16) {
      issues.push(
        `content hash mismatch for ${record.fileName}: manifest=${record.sha256_16} actual=${actual.slice(0, 16)}`,
      );
    }
  }
  return issues;
}

/**
 * 校验平台资源 manifest 与实际文件字节一致（构建/启动期调用，见
 * next.config.ts；测试可传入临时目录）。发现问题直接抛错阻止启动——
 * 绝不允许旧 immutable URL 服务新字节。
 */
export function validatePlatformManifest(
  dir: string = PLATFORM_SHARED_DIR,
): void {
  const issues = manifestIssues(dir);
  if (issues.length > 0) {
    throw new Error(
      `platform manifest validation failed:\n- ${issues.join("\n- ")}`,
    );
  }
}
