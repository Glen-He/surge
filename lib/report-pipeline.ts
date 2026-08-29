// 报告文档渲染（登录态查看页与分享页共用）。
//
// 架构：报告文件通过 /r/<cap>/ 虚拟目录原样输出（capability 即访问凭证，
// 见 lib/report-capability.ts），浏览器按文档 URL 原生解析一切相对引用，
// 平台不做任何资源路径改写。本模块只负责与路径无关的确定性后处理：
// 平台内置库的约定路径映射、剥离模板自带报告头、注入 PDF 桥接与滚动条样式。

import { REPORT_SANDBOX_TOKENS } from "@/lib/report-security";

// 报告文档统一 CSP：
// - sandbox：即使被直接在标签页打开，也降级为 opaque origin
//   （无 cookie/storage/同源权能），与外层 iframe sandbox 形成双层隔离；
//   仅额外允许下载和由用户触发的新标签页，以支持报告附件与 DOI/PMID 外链
// - 本 capability 目录内的资源、数据请求、媒体与 Worker 默认可用；
// - 报告可直接使用外部 HTTPS 资源/API，HTTP 与其他协议禁止；
// - 表单提交、插件对象与 base URL 改写始终禁止。
//   注意一：sandbox 使文档成为 opaque origin，CSP 的 'self' 永不匹配，
//   必须显式 origin。注意二：host source 支持路径前缀（以 / 结尾），
//   收紧到 /r/<cap>/ 而非整个主站 origin——服务端授权与浏览器 CSP
//   限制在同一个 capability namespace，主站其他路径（如 /api/*）
//   即使被写进 <img>/<script> 也会被 CSP 拦截
export function reportDocCsp(
  capBase: string,
  frameAncestor: string,
): string {
  return [
    `sandbox ${REPORT_SANDBOX_TOKENS}`,
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${capBase}/ https:`,
    `style-src 'unsafe-inline' ${capBase}/ https:`,
    `img-src ${capBase}/ data: blob: https:`,
    `font-src ${capBase}/ data: https:`,
    `media-src ${capBase}/ data: blob: https:`,
    // 嵌入式 PDF 预览等场景：允许报告内嵌 <iframe> 指向 capability 目录
    `frame-src ${capBase}/ https:`,
    `connect-src ${capBase}/ https:`,
    `worker-src ${capBase}/ blob: https:`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestor}`,
  ].join("; ");
}

// PDF 桥接：报告始终留在 opaque-origin sandbox 中，只把“用户要预览/下载
// 哪个 PDF”通过 postMessage 告知可信父页。父页会再次校验 URL 必须位于当前
// capability 目录内。这样无需 allow-same-origin，也不依赖各浏览器能否在
// sandbox 内运行内置 PDF 阅读器。
const reportPdfBridgeScript =
  '<script>(function(){var lastGesture=0;function pdfUrl(value){if(!value)return"";try{var u=new URL(value,document.baseURI);return /\\.pdf$/i.test(u.pathname)?u.href:""}catch(e){return""}}function send(action,url,title){try{if(window.parent!==window)window.parent.postMessage({__surgeReportPdf:{action:action,url:url,title:title||"PDF 预览"}},"*")}catch(e){}}function frameTitle(frame){var fixed=frame.parentElement&&frame.parentElement.querySelector(".pdf-title");return fixed&&fixed.textContent&&fixed.textContent.trim()||frame.getAttribute("title")||document.title||"PDF 预览"}function hideSandboxViewer(frame){var node=frame;while(node&&node!==document.body){try{if(getComputedStyle(node).position==="fixed"){node.style.display="none";return}}catch(e){}node=node.parentElement}frame.style.display="none"}function interceptFrame(frame){if(!(frame instanceof HTMLIFrameElement)||Date.now()-lastGesture>1500)return;var url=pdfUrl(frame.getAttribute("src"));if(!url)return;frame.setAttribute("src","about:blank");hideSandboxViewer(frame);send("preview",url,frameTitle(frame))}document.addEventListener("click",function(event){lastGesture=Date.now();var target=event.target instanceof Element?event.target:null;var link=target&&target.closest("a[href]");if(link&&link.target==="_blank"){link.relList.add("noopener");link.relList.add("noreferrer")}if(!link||!link.hasAttribute("download"))return;var url=pdfUrl(link.getAttribute("href"));if(!url)return;event.preventDefault();send("download",url,link.getAttribute("download")||"")},true);new MutationObserver(function(records){for(var i=0;i<records.length;i++){var target=records[i].target;if(target instanceof HTMLIFrameElement)interceptFrame(target)}}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["src"]})})();</script>';

/**
 * 报告入口 HTML 的确定性后处理（与资源路径解析无关，平台约定层面）：
 * 1. 平台内置库约定路径（../../lib/echarts.min.js 等旧约定）映射到
 *    虚拟目录内的 ./_platform/ ——唯一保留的兼容改写，模式确定、不扫描内容；
 * 2. 剥离模板自带的报告头（标题 + 返回按钮）：页面统一在上方渲染系统头；
 * 3. 注入 PDF/内容高度桥接 + 滚动条隐藏样式。
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

  // 隐藏 iframe 文档自身的滚动条，保留滚轮/触控滚动能力。
  // - 滚动条隐藏样式必须注入 <head> 首位：Safari 首绘早于文档尾解析，
  //   若放在 </body> 前，首帧会按「有滚动条槽」布局、样式生效后槽释放，
  //   居中内容会向右滑约 7px（打开报告瞬间卡片从左向右移动一下的根因）
  const injectStyle =
    '<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style>';
  // 登录态汇报页需要让外层页面成为唯一滚动容器，因此 iframe 把内容高度
  // 告知父页以撑开自身。分享页仍保留独立视口，收到消息也不会采用该高度。
  const reportHeightBridgeScript =
    '<script>(function(){var queued=false,last=0;function measure(){queued=false;var d=document.documentElement,b=document.body;var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);if(!h||h===last)return;last=h;try{if(window.parent!==window)window.parent.postMessage({__surgeReportHeight:h},"*")}catch(e){}}function schedule(){if(queued)return;queued=true;requestAnimationFrame(measure)}schedule();window.addEventListener("load",schedule);window.addEventListener("resize",schedule);if(window.ResizeObserver&&document.documentElement){try{new ResizeObserver(schedule).observe(document.documentElement)}catch(e){}}setTimeout(schedule,300);setTimeout(schedule,1500)})();</script>';
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
    html = html.replace(
      /<\/body>/i,
      `${reportHeightBridgeScript}</body>`,
    );
  } else {
    html += reportHeightBridgeScript;
  }
  return html;
}
