import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { db } from "@/infrastructure/database/client";
import {
  reportBridgeToken,
  reportResourceEtag,
  requestMatchesEtag,
  verifyCapability,
} from "@/features/reports/report-capability";
import { renderReportDoc, reportDocCsp } from "@/features/reports/serving/render-report-doc";
import {
  applicationOrigin,
  isReportOriginRequest,
  reportsOrigin,
} from "@/features/reports/serving/report-origin";
import { reportContentDir } from "@/features/reports/storage/report-storage";
import { REPORT_PDF_DOWNLOAD_PARAM } from "@/features/reports/viewer/report-pdf";
import { parseByteRange } from "@/features/reports/serving/parse-byte-range";
import { REPORT_PERMISSIONS_POLICY } from "@/features/reports/serving/report-security";

export const dynamic = "force-dynamic";

// ── 报告虚拟目录运行时（/r/<cap>/<path...>）──
//
// <cap> 是 capability（HMAC 签名的 reportId+revision+epoch+expires，见
// lib/report-capability.ts），/r/<cap>/ 即报告的虚拟根目录：入口文档
// /r/<cap>/report.html，其余相对引用（./data.js、images/a.png、CSS url()）
// 由浏览器按文档 URL 原生解析，落在同一命名空间下。
//
// 本路由只认 capability：不查 session、不看 share token——「谁有资格打开
// 报告」由父页面（登录态查看页 / 分享页）在签发 capability 前裁决。
// 每个请求：验签 → 比对数据库当前 revision + epoch（报告已更新或权限已
// 吊销则旧 cap 整体 404，不泄露存在性）→ 安全定位文件 → 输出。
// 仅导出 GET（HEAD 由框架代理）；无任何写语义。

// 服务端按扩展名判定的 MIME（不信任上传声明）。
// 不在此表内的扩展名一律 octet-stream + attachment（见下方处理）。
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
};
// 可导航的活动文档类型：被浏览器直接打开时内部脚本会以站点同源身份运行，
// 必须挂 sandbox CSP 降级（.html 含入口与非入口；.svg 单独更严策略）
const ACTIVE_DOC_RE = /\.(html?|xhtml)$/i;

function extOf(p: string) {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

function notFound(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cap: string; path: string[] }> },
) {
  // 独立内容域是主动安全边界：主站 origin 上即使拿到 capability 也不输出
  // 活动报告文件。本地开发未配置 REPORTS_ORIGIN 时两者相同，仍可正常工作。
  if (!isReportOriginRequest(req)) return notFound();

  const { cap, path: segments } = await params;
  const grant = verifyCapability(cap);
  if (!grant) return notFound();

  // 报告定位 + 当前世代/纪元校验：报告被删除、文件被替换（revision 轮换）
  // 或权限被吊销（epoch 递增，如撤销分享）后，旧 capability 立即整体失效
  const r = await db.query<{
    user_id: string;
    revision_id: string;
    capability_epoch: number;
    template_key: string | null;
    storage_key: string | null;
  }>(
    `SELECT user_id, revision_id, capability_epoch, template_key, storage_key
     FROM reports WHERE id = $1 LIMIT 1`,
    [grant.reportId],
  );
  const row = r.rows[0];
  if (
    !row ||
    row.revision_id !== grant.revisionId ||
    row.capability_epoch !== grant.epoch
  ) {
    return notFound();
  }

  // 安全定位（读取阶段二次防御，不依赖上传阶段的检查）：
  // segment 级禁 . / .. / 空段只是前置过滤；真正的安全不变量是下方
  // resolve 后的目录包含检查——无论 URL 编码如何构造，最终用于文件系统
  // 的路径必须严格位于报告根目录内。平台内置库不在此命名空间输出，
  // 一律走 /platform/ 版本化 URL（见 lib/platform-assets.ts）
  if (segments.some((s) => !s || s === "." || s === "..")) return notFound();
  const rel = segments.join("/");

  let allowedRoot: string;
  try {
    allowedRoot = reportContentDir({
      userId: row.user_id,
      templateKey: row.template_key,
      storageKey: row.storage_key,
    });
  } catch {
    return notFound();
  }
  const filePath = path.resolve(allowedRoot, rel);
  if (filePath !== allowedRoot && !filePath.startsWith(allowedRoot + path.sep)) {
    return notFound();
  }

  let realFile: string;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    // 即使持久卷内容被外部篡改，realpath 仍会在读取阶段阻断符号链接越界。
    const [realRoot, resolvedFile] = await Promise.all([
      fs.realpath(allowedRoot),
      fs.realpath(filePath),
    ]);
    if (
      resolvedFile !== realRoot &&
      !resolvedFile.startsWith(realRoot + path.sep)
    ) {
      return notFound();
    }
    realFile = resolvedFile;
    stat = await fs.stat(/* turbopackIgnore: true */ realFile);
    if (!stat.isFile()) return notFound();
  } catch {
    return notFound();
  }
  const ext = extOf(filePath);
  const isEntryDoc = rel === "report.html";

  const headers: Record<string, string> = {
    // MIME 由服务端按扩展名判定，不信任上传声明
    "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    // capability URL 即凭证（无 Cookie 授权），允许无凭证跨源读取：
    // ES Module 等 CORS-required 加载在 opaque origin 下必需
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": REPORT_PERMISSIONS_POLICY,
    // 所有可导航资源（尤其 PDF）只允许主站查看器嵌入。
    "Content-Security-Policy": `frame-ancestors ${applicationOrigin()}`,
    // 入口 HTML 含 capability 且会被动态注入，继续 no-store。
    // 静态子资源只允许浏览器私有缓存，并要求每次复用前回源
    // 验权；ETag 命中返 304，避免重复传输大图，同时保留撤销即时性。
    "Cache-Control": isEntryDoc
      ? "private, no-store"
      : "private, no-cache, must-revalidate",
  };

  if (isEntryDoc) {
    // 入口 HTML 内含仅供平台桥接使用的认证 token。导航与 iframe 嵌入不需要
    // CORS；不下发 ACAO，阻止 opaque-origin 汇报脚本 fetch 后读取注入源码。
    delete headers["Access-Control-Allow-Origin"];
    // 入口文档：确定性后处理 + 统一网页汇报 CSP。
    // 仅允许当前 capability 目录中的资源，外部网络始终禁止。
    let content: Buffer;
    try {
      // 运行时数据独立挂载，绝不能被复制进构建产物追踪。
      content = await fs.readFile(/* turbopackIgnore: true */ realFile);
    } catch {
      return notFound();
    }
    return new Response(
      renderReportDoc(content.toString("utf-8"), reportBridgeToken(cap)),
      {
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": reportDocCsp(
            `${reportsOrigin()}/r/${cap}`,
            applicationOrigin(),
          ),
        },
      },
    );
  }

  const etag = reportResourceEtag(
    row.revision_id,
    rel,
    stat.size,
    stat.mtimeMs,
  );
  headers.ETag = etag;
  headers["Last-Modified"] = stat.mtime.toUTCString();
  headers["Accept-Ranges"] = "bytes";

  // 先完成 capability + DB 世代/纪元 + 真实路径校验，才允许
  // 304。因此报告替换、删除或撤销分享仍然会立即拒绝旧 URL。
  if (requestMatchesEtag(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  // 可导航类型防同源脚本执行（纵深防御）：
  // - .html/.htm/.xhtml：sandbox 让文档运行在无源沙箱，脚本完全失效
  // - .svg：允许内联样式正常渲染，禁掉脚本与外链
  // 作为子资源（<img>、<iframe> 之外）嵌入时不受影响。
  // 未知扩展名：octet-stream + attachment，禁止浏览器猜测渲染。
  if (ACTIVE_DOC_RE.test(rel)) {
    headers["Content-Security-Policy"] =
      `sandbox; frame-ancestors ${applicationOrigin()}`;
  } else if (ext === ".svg") {
    headers["Content-Security-Policy"] =
      `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors ${applicationOrigin()}`;
  } else if (!(ext in CONTENT_TYPES)) {
    headers["Content-Disposition"] = "attachment";
  }

  // PDF 下载必须由可信父页显式加平台参数。不能依赖 Sec-Fetch-Dest：报告
  // 自身就在 iframe 内，无论点击下载链接还是嵌套预览，请求目的通常都是
  // iframe。显式参数让下载稳定返回 attachment，普通 PDF 请求保持 inline。
  if (
    ext === ".pdf" &&
    new URL(req.url).searchParams.get(REPORT_PDF_DOWNLOAD_PARAM) === "1"
  ) {
    headers["Content-Disposition"] = "attachment";
  }

  const rangeHeader = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  const mayUseRange =
    !ifRange || ifRange === etag || ifRange === headers["Last-Modified"];
  const range = mayUseRange ? parseByteRange(rangeHeader, stat.size) : null;
  if (rangeHeader && mayUseRange && !range) {
    headers["Content-Range"] = `bytes */${stat.size}`;
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
  } else {
    headers["Content-Length"] = String(stat.size);
  }
  // 非 HTML 资源直接流式输出，避免多张大图同时请求时把整个
  // 文件全部读入 Node.js 内存，也能更早开始向浏览器传输。
  const body = Readable.toWeb(
    createReadStream(
      /* turbopackIgnore: true */ realFile,
      range ? { start: range.start, end: range.end } : undefined,
    ),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}
