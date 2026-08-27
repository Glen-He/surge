// 报告文档渲染（登录态查看页与分享页共用）。
//
// 架构：报告文件通过 /r/<cap>/ 虚拟目录原样输出（capability 即访问凭证，
// 见 lib/report-capability.ts），浏览器按文档 URL 原生解析一切相对引用，
// 平台不做任何资源路径改写。本模块只负责与路径无关的确定性后处理：
// 平台内置库的约定路径映射、剥离模板自带报告头、注入高度上报与滚动条样式。

// 报告文档统一 CSP：
// - sandbox allow-scripts：即使被直接在标签页打开，也降级为 opaque origin
//   （无 cookie/storage/同源权能），与外层 iframe sandbox 形成双层隔离
// - connect-src 'none'：断掉一切网络外发（fetch/XHR/beacon）；
//   数据一律通过 <script src="data.js"> 引入，无需放开
// - worker-src 'none'：明确禁 Worker（否则回退继承 script-src）
// - script/style/img/font 只允许本 capability 虚拟目录与内联。
//   注意一：sandbox 使文档成为 opaque origin，CSP 的 'self' 永不匹配，
//   必须显式 origin。注意二：host source 支持路径前缀（以 / 结尾），
//   收紧到 /r/<cap>/ 而非整个主站 origin——服务端授权与浏览器 CSP
//   限制在同一个 capability namespace，主站其他路径（如 /api/*）
//   即使被写进 <img>/<script> 也会被 CSP 拦截
export function reportDocCsp(capBase: string): string {
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline' ${capBase}/`,
    `style-src 'unsafe-inline' ${capBase}/`,
    `img-src ${capBase}/ data: blob:`,
    `font-src ${capBase}/ data:`,
    // 嵌入式 PDF 预览等场景：允许报告内嵌 <iframe> 指向 capability 目录
    `frame-src ${capBase}/`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'none'",
  ].join("; ");
}

// PDF 桥接：报告始终留在 opaque-origin sandbox 中，只把“用户要预览/下载
// 哪个 PDF”通过 postMessage 告知可信父页。父页会再次校验 URL 必须位于当前
// capability 目录内。这样无需 allow-same-origin，也不依赖各浏览器能否在
// sandbox 内运行内置 PDF 阅读器。
const reportPdfBridgeScript =
  '<script>(function(){var lastGesture=0;function pdfUrl(value){if(!value)return"";try{var u=new URL(value,document.baseURI);return /\\.pdf$/i.test(u.pathname)?u.href:""}catch(e){return""}}function send(action,url,title){try{if(window.parent!==window)window.parent.postMessage({__surgeReportPdf:{action:action,url:url,title:title||"PDF 预览"}},"*")}catch(e){}}function frameTitle(frame){var fixed=frame.parentElement&&frame.parentElement.querySelector(".pdf-title");return fixed&&fixed.textContent&&fixed.textContent.trim()||frame.getAttribute("title")||document.title||"PDF 预览"}function hideSandboxViewer(frame){var node=frame;while(node&&node!==document.body){try{if(getComputedStyle(node).position==="fixed"){node.style.display="none";return}}catch(e){}node=node.parentElement}frame.style.display="none"}function interceptFrame(frame){if(!(frame instanceof HTMLIFrameElement)||Date.now()-lastGesture>1500)return;var url=pdfUrl(frame.getAttribute("src"));if(!url)return;frame.setAttribute("src","about:blank");hideSandboxViewer(frame);send("preview",url,frameTitle(frame))}document.addEventListener("click",function(event){lastGesture=Date.now();var target=event.target instanceof Element?event.target:null;var link=target&&target.closest("a[href]");if(!link||!link.hasAttribute("download"))return;var url=pdfUrl(link.getAttribute("href"));if(!url)return;event.preventDefault();send("download",url,link.getAttribute("download")||"")},true);new MutationObserver(function(records){for(var i=0;i<records.length;i++){var target=records[i].target;if(target instanceof HTMLIFrameElement)interceptFrame(target)}}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["src"]})})();</script>';

// 从请求头构造站点 origin（优先反代头；本地开发 http）。用于上述 CSP 的显式 origin。
export function requestOrigin(req: Request): string {
  const configured =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return new URL(configured).origin;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * 报告入口 HTML 的确定性后处理（与资源路径解析无关，平台约定层面）：
 * 1. 平台内置库约定路径（../../lib/echarts.min.js 等旧约定）映射到
 *    虚拟目录内的 ./_platform/ ——唯一保留的兼容改写，模式确定、不扫描内容；
 * 2. 剥离模板自带的报告头（标题 + 返回按钮）：页面统一在上方渲染系统头；
 * 3. 注入高度上报脚本 + 滚动条隐藏样式。
 */
export function renderReportDoc(html: string): string {
  // 平台内置库：旧约定的 ../..(../)lib/X → ./_platform/X
  html = html.replace(
    /(src|href)="\.\.\/(?:\.\.\/)?lib\/([^"]+)"/g,
    (_m, attr: string, file: string) => `${attr}="./_platform/${file}"`,
  );

  // 剥离模板自带的报告头
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
    '<script>(function(){var queued=false,last=0;function measure(){queued=false;var d=document.documentElement,b=document.body;var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);if(!h||h===last)return;last=h;try{if(window.parent!==window)window.parent.postMessage({__surgeReportHeight:h},"*")}catch(e){}}function send(){if(queued)return;queued=true;if(window.requestAnimationFrame)requestAnimationFrame(measure);else setTimeout(measure,16)}send();window.addEventListener("load",send);window.addEventListener("resize",send);if(window.ResizeObserver&&document.documentElement){try{new ResizeObserver(send).observe(document.documentElement)}catch(e){}}setTimeout(send,300);setTimeout(send,1500)})();</script>';
  if (/<head[^>]*>/i.test(html)) {
    // 桥接脚本放在 head 首位，确保报告自己的点击处理器设置 PDF iframe.src
    // 时观察器已经就绪。
    html = html.replace(
      /<head[^>]*>/i,
      (m) => m + injectStyle + reportPdfBridgeScript,
    );
  } else {
    html = injectStyle + reportPdfBridgeScript + html;
  }
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${injectScript}</body>`);
  } else {
    html += injectScript;
  }

  return html;
}
