import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { ensureOtpMigration } from "@/lib/schema";
import { verifyCapability } from "@/lib/report-capability";
import { renderReportDoc, reportDocCsp, requestOrigin } from "@/lib/report-pipeline";
import {
  REPORT_SHARED_DIR,
  reportDir,
} from "@/lib/report-storage";

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

const SHARED_DIR = REPORT_SHARED_DIR;

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
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
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
  const { cap, path: segments } = await params;
  const grant = verifyCapability(cap);
  if (!grant) return notFound();

  await ensureOtpMigration();

  // 报告定位 + 当前世代/纪元校验：报告被删除、文件被替换（revision 轮换）
  // 或权限被吊销（epoch 递增，如撤销分享）后，旧 capability 立即整体失效
  const r = await db.query<{
    user_id: string;
    slug: string;
    revision_id: string;
    capability_epoch: number;
  }>(
    `SELECT user_id, slug, revision_id, capability_epoch FROM reports WHERE id = $1 LIMIT 1`,
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
  // 的路径必须严格位于报告根目录内
  if (segments.some((s) => !s || s === "." || s === "..")) return notFound();
  const rel = segments.join("/");

  // _platform/*：平台内置库命名空间（echarts 等），映射到受控公共目录
  let filePath: string;
  let allowedRoot: string;
  if (segments[0] === "_platform") {
    allowedRoot = path.resolve(SHARED_DIR);
    filePath = path.resolve(SHARED_DIR, segments.slice(1).join("/"));
  } else {
    try {
      allowedRoot = reportDir(row.user_id, row.slug);
    } catch {
      return notFound();
    }
    filePath = path.resolve(allowedRoot, rel);
  }
  if (filePath !== allowedRoot && !filePath.startsWith(allowedRoot + path.sep)) {
    return notFound();
  }

  let content: Buffer;
  try {
    // realpath closes the read-time symlink escape for legacy/on-disk data as
    // well as archives accepted by older application versions.
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(allowedRoot),
      fs.realpath(filePath),
    ]);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
      return notFound();
    }
    // Runtime data is mounted separately and must never be copied into a build trace.
    content = await fs.readFile(/* turbopackIgnore: true */ realFile);
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
    "Referrer-Policy": "no-referrer",
    // capability 出现在 URL 里，严禁公共缓存；文档不缓存（替换后立即失效）
    "Cache-Control": "private, no-store",
  };

  if (isEntryDoc) {
    // 入口文档：确定性后处理（内置库路径映射 / 剥报告头 / 注入高度脚本）+
    // 完整文档 CSP——资源 source 收紧到本 capability 虚拟目录前缀
    // （脚本可在沙箱内跑图表，connect-src 'none' 断网络外发）
    return new Response(renderReportDoc(content.toString("utf-8")), {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": reportDocCsp(
          `${requestOrigin(req)}/r/${cap}`,
        ),
      },
    });
  }

  // 可导航类型防同源脚本执行（纵深防御）：
  // - .html/.htm/.xhtml：sandbox 让文档运行在无源沙箱，脚本完全失效
  // - .svg：允许内联样式正常渲染，禁掉脚本与外链
  // 作为子资源（<img>、<iframe> 之外）嵌入时不受影响。
  // 未知扩展名：octet-stream + attachment，禁止浏览器猜测渲染。
  if (ACTIVE_DOC_RE.test(rel)) {
    headers["Content-Security-Policy"] = "sandbox";
  } else if (ext === ".svg") {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'";
  } else if (!(ext in CONTENT_TYPES)) {
    headers["Content-Disposition"] = "attachment";
  }

  return new Response(Uint8Array.from(content), { headers });
}
