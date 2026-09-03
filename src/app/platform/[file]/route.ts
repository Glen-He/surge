import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import {
  PLATFORM_SHARED_DIR,
  resolvePlatformAsset,
} from "@/features/reports/serving/platform-assets";
import { isReportOriginRequest } from "@/features/reports/serving/report-origin";

export const dynamic = "force-dynamic";

// ── 平台公共资源运行时（/platform/<file>）──
//
// 与 /r/<cap>/ 的 capability 命名空间分离：只输出 reports/_shared 内
// manifest 白名单登记的平台内置库（echarts 等）。磁盘文件名与 URL 文件名
// 一致并内嵌内容 hash，文件内容变化 → 换新文件名并更新 manifest → URL
// 轮换，因此可公开长期缓存：
//   Cache-Control: public, max-age=31536000, immutable
// 同一浏览器跨报告共享一份缓存。安全模型：
// - 文件系统路径只来自 manifest（git 追踪），URL 参数仅用于精确查找登记
//   条目，不参与路径拼接，不存在目录穿越面；
// - 不查数据库、不要求 capability（输出的是公开库字节，不含任何用户数据，
//   用户报告内容仍只能通过 /r/<cap>/ 访问）；
// - 仅在内容域（reports origin）输出，与 /r/* 同一收口边界。

function notFound(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  if (!isReportOriginRequest(req)) return notFound();

  const { file } = await params;
  const resolved = resolvePlatformAsset(file);
  if (!resolved) return notFound();
  const { entry } = resolved;

  // 防御性复核 manifest 值本身：entry.fileName 是磁盘/URL 共用名，必须是
  // 简单文件名（防止 manifest 被误写成相对/嵌套路径）。
  if (path.basename(entry.fileName) !== entry.fileName) {
    return notFound();
  }
  const filePath = path.resolve(PLATFORM_SHARED_DIR, entry.fileName);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(/* turbopackIgnore: true */ filePath);
    if (!stat.isFile()) return notFound();
  } catch {
    return notFound();
  }

  const headers: Record<string, string> = {
    "Content-Type": entry.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
    // 公开内容，允许无凭证跨源读取（与 /r/ 静态资源响应头对齐）；
    // TAO 让 sandbox 报告内的 ResourceTiming 能如实报告缓存命中
    // （transferSize=0）与传输字节，供性能验证使用，不暴露任何内容
    "Access-Control-Allow-Origin": "*",
    "Timing-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "Content-Length": String(stat.size),
  };

  const body = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ filePath),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, { headers });
}
