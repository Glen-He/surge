import { promises as fs } from "fs";
import { createHmac, timingSafeEqual } from "crypto";
import path from "path";

// 报告 HTML 渲染管线（登录态报告页与公开分享页共用）：
// 职责是"把提交的 HTML 里的相对资源引用，改写为某个可鉴权/可校验的资产端点"。
// 两个上下文的差异只在资产 URL 前缀，由 assetUrl 参数注入：
// - 登录态：/api/report-assets?p=…（签名或 cookie 鉴权 + userId 目录约束）
// - 分享：  /api/share/{token}/asset?p=…（token 即凭证）

export interface PipelineOptions {
  /** 相对引用 → 资产端点绝对 URL；p 形如 "_shared/echarts.min.js" 或 "<slug>/data.js" */
  assetUrl: (p: string) => string;
}

// 报告文档（登录态 /api/reports/[slug]/page 与分享 /api/share/[token]/page）统一 CSP：
// - sandbox allow-scripts：即使被直接在标签页打开，也降级为 opaque origin（无 cookie/storage/同源权能），
//   与外层 iframe sandbox 形成双层隔离
// - connect-src 'none'：断掉一切网络外发（fetch/XHR/beacon）
// - script/style/img/font 只允许本站资产端点与内联（报告图表脚本可跑，外部脚本不可加载）。
//   注意：sandbox 使文档成为 opaque origin，CSP 的 'self' 永不匹配（实测会拦掉
//   /api/report-assets 的 echarts.min.js），因此必须用显式 origin 代替 'self'
export function reportDocCsp(origin: string): string {
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline' ${origin}`,
    `style-src 'unsafe-inline' ${origin}`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// 从请求头构造站点 origin（优先反代头；本地开发 http）。用于上述 CSP 的显式 origin。
export function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

// ── 登录态资产 URL 的 HMAC 签名 ──
// 报告文档运行在 sandbox（opaque origin）内，其子资源请求被浏览器标记为
// cross-site，SameSite=Lax 的会话 cookie 不会随请求发送 → /api/report-assets
// 会 401，echarts 等脚本被 ORB 拦截（图表消失）。因此页面路由（有会话、已验
// 归属）为每个资产 URL 附加短期签名，资产端点验签通过即可免 cookie 放行。
const ASSET_SIG_TTL_SEC = 24 * 60 * 60;

// 密钥解析：BETTER_AUTH_SECRET / AUTH_SECRET 优先 → 生产环境缺失直接抛错
// （绝不静默落入固定值，否则资产 URL 签名可被伪造）→ 开发环境用固定值
function assetSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少 BETTER_AUTH_SECRET：资产 URL 签名无密钥");
  }
  return "surge-dev-asset-secret";
}

function assetHmac(p: string, u: string, e: number): string {
  return createHmac("sha256", assetSecret()).update(`${p}|${u}|${e}`).digest("base64url");
}

/** 生成带签名的登录态资产 URL（p 为资产逻辑路径，u 为属主 userId） */
export function signedAssetUrl(p: string, userId: string): string {
  const e = Math.floor(Date.now() / 1000) + ASSET_SIG_TTL_SEC;
  return `/api/report-assets?p=${encodeURIComponent(p)}&u=${encodeURIComponent(userId)}&e=${e}&t=${encodeURIComponent(assetHmac(p, userId, e))}`;
}

/** 校验资产 URL 签名（恒时比较；过期即失效）。p 必须是请求中的原始 p 值 */
export function verifyAssetSig(p: string, u: string, e: number, t: string): boolean {
  if (!p || !u || !t || !Number.isFinite(e)) return false;
  if (e * 1000 < Date.now()) return false;
  const expect = Buffer.from(assetHmac(p, u, e));
  const got = Buffer.from(t);
  return expect.length === got.length && timingSafeEqual(expect, got);
}

const STATIC_RE = /\.(css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot)$/i;

function staticFilter(file: string): boolean {
  if (file.startsWith("/") || /^https?:/i.test(file) || file.startsWith("data:")) {
    return false;
  }
  const clean = file.split("?")[0].split("#")[0];
  return !!clean && STATIC_RE.test(clean);
}

/**
 * 重写整份 HTML 的资源引用（含 <style> 块与 style 属性内的 CSS url()/@import）。
 * 返回处理后的完整 HTML 文本；不做 DOM 片段抽取（那是登录态页面进一步做的事）。
 */
export function rewriteReportHtml(
  html: string,
  slug: string,
  opts: PipelineOptions,
): string {
  const { assetUrl } = opts;
  const proxy = (file: string) => assetUrl(`${slug}/${file}`);

  // 公共资源（echarts 等）在 _shared
  html = html.replace(
    /(src|href)="\.\.\/\.\.\/lib\/([^"]+)"/g,
    (_m, attr, file) => `${attr}="${assetUrl(`_shared/${file}`)}"`,
  );
  html = html.replace(
    /(src|href)="\.\.\/(lib\/[^"]+)"/g,
    (_m, attr, file) => `${attr}="${assetUrl(`_shared/${file.slice(4)}`)}"`,
  );
  // 项目内相对脚本（data.js 等）
  html = html.replace(
    /(src|href)="([^"]+\.js)"\s*(?![^>]*type=["']module)/g,
    (m, attr: string, file: string) => {
      if (file.startsWith("/") || file.startsWith("http")) return m;
      return `${attr}="${proxy(file)}"`;
    },
  );
  // 包内静态资源：<link href> / <img src> 等标签属性
  html = html.replace(/(src|href)="([^"]+)"/g, (m, attr: string, file: string) => {
    if (!staticFilter(file)) return m;
    return `${attr}="${proxy(file)}"`;
  });
  // CSS url(...) / @import 只在 <style> 块与 style="" 属性内重写，不碰正文文本
  const rewriteCssRefs = (css: string) =>
    css
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, file: string) => {
        if (!staticFilter(file)) return m;
        return `url("${proxy(file)}")`;
      })
      .replace(/@import\s+(['"])([^'"]+)\1/g, (m, _q, file: string) => {
        if (!staticFilter(file)) return m;
        return `@import "${proxy(file)}"`;
      });
  html = html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (_m, attrs: string, css: string) => `<style${attrs}>${rewriteCssRefs(css)}</style>`,
  );
  html = html.replace(
    /style="([^"]*)"/gi,
    (m, s: string) => (s.includes("url(") ? `style="${rewriteCssRefs(s)}"` : m),
  );

  // 剥离模板自带的报告头（标题 + 返回按钮）：两个上下文都在页面上方统一渲染标题
  html = html.replace(
    /<header\b[^>]*class="[^"]*\brpt-head\b[^"]*"[^>]*>[\s\S]*?<\/header>/gi,
    "",
  );

  // 注入高度上报脚本 + 滚动条隐藏样式：
  // - 外层页面（系统头 + iframe）整体滚动，iframe 需要自适应报告真实内容高度；
  //   报告文档在沙箱内把自己的 scrollHeight postMessage 给父页（ReportFrame 接收）
  // - 顺带隐藏 iframe 文档自身的滚动条（外层全局滚动条已隐藏，保持一致）
  // - 滚动条隐藏样式必须注入 <head> 首位：Safari 首绘早于文档尾解析，
  //   若放在 </body> 前，首帧会按「有滚动条槽」布局、样式生效后槽释放，
  //   居中内容会向右滑约 7px（打开报告瞬间卡片从左向右移动一下的根因）
  const injectStyle =
    '<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style>';
  const injectScript =
    '<script>(function(){function send(){var d=document.documentElement,b=document.body;var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);if(!h)return;try{if(window.parent!==window)window.parent.postMessage({__surgeReportHeight:h},"*")}catch(e){}}send();window.addEventListener("load",send);window.addEventListener("resize",send);if(window.ResizeObserver&&document.documentElement){try{new ResizeObserver(send).observe(document.documentElement)}catch(e){}}setTimeout(send,300);setTimeout(send,1500)})();</script>';
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + injectStyle);
  } else {
    html = injectStyle + html;
  }
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${injectScript}</body>`);
  } else {
    html += injectScript;
  }

  return html;
}

/**
 * 读取并重写一份报告的 HTML。
 * @param dir 报告的完整目录（即 reports/users/{ownerId}/{slug}）
 * @param slug 报告 slug（用于拼接资产端点里的 "<slug>/file" 引用）
 */
export async function loadReportHtml(
  dir: string,
  slug: string,
  opts: PipelineOptions,
): Promise<string> {
  const raw = await fs.readFile(path.join(dir, "report.html"), "utf-8");
  return rewriteReportHtml(raw, slug, opts);
}
