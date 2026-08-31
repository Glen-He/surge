// 报告文档渲染（登录态查看页与分享页共用）。
//
// 架构：报告文件通过 /r/<cap>/ 虚拟目录原样输出（capability 即访问凭证，
// 见 lib/report-capability.ts），浏览器按文档 URL 原生解析一切相对引用，
// 平台不做任何资源路径改写。本模块只负责与路径无关的确定性后处理：
// 剥离模板自带报告头、注入 PDF 桥接与滚动条样式。

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
  externalNetworkEnabled = true,
): string {
  const external = externalNetworkEnabled ? " https:" : "";
  return [
    `sandbox ${REPORT_SANDBOX_TOKENS}`,
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${capBase}/${external}`,
    `style-src 'unsafe-inline' ${capBase}/${external}`,
    `img-src ${capBase}/ data: blob:${external}`,
    `font-src ${capBase}/ data:${external}`,
    `media-src ${capBase}/ data: blob:${external}`,
    // 嵌入式 PDF 预览等场景：允许报告内嵌 <iframe> 指向 capability 目录
    `frame-src ${capBase}/${external}`,
    `connect-src ${capBase}/${external}`,
    `worker-src ${capBase}/ blob:${external}`,
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
function reportPdfBridgeScript(bridgeToken: string): string {
  return `<script>(function(bridgeToken){var own=document.currentScript;if(own)own.remove();var lastGesture=0;function pdfUrl(value){if(!value)return"";try{var u=new URL(value,document.baseURI);return /\\.pdf$/i.test(u.pathname)?u.href:""}catch(e){return""}}function send(action,url,title){try{if(window.parent!==window)window.parent.postMessage({__surgeReportPdf:{action:action,url:url,title:title||"PDF 预览",bridgeToken:bridgeToken}},"*")}catch(e){}}function frameTitle(frame){var fixed=frame.parentElement&&frame.parentElement.querySelector(".pdf-title");return fixed&&fixed.textContent&&fixed.textContent.trim()||frame.getAttribute("title")||document.title||"PDF 预览"}function hideSandboxViewer(frame){var node=frame;while(node&&node!==document.body){try{if(getComputedStyle(node).position==="fixed"){node.style.display="none";return}}catch(e){}node=node.parentElement}frame.style.display="none"}function interceptFrame(frame){if(!(frame instanceof HTMLIFrameElement)||Date.now()-lastGesture>1500)return;var url=pdfUrl(frame.getAttribute("src"));if(!url)return;frame.setAttribute("src","about:blank");hideSandboxViewer(frame);send("preview",url,frameTitle(frame))}document.addEventListener("click",function(event){lastGesture=Date.now();var target=event.target instanceof Element?event.target:null;var link=target&&target.closest("a[href]");if(link&&link.target==="_blank"){link.relList.add("noopener");link.relList.add("noreferrer")}if(!link||!link.hasAttribute("download"))return;var url=pdfUrl(link.getAttribute("href"));if(!url)return;event.preventDefault();send("download",url,link.getAttribute("download")||"")},true);new MutationObserver(function(records){for(var i=0;i<records.length;i++){var target=records[i].target;if(target instanceof HTMLIFrameElement)interceptFrame(target)}}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["src"]})})(${JSON.stringify(bridgeToken)});</script>`;
}

// 可见系统头进入 iframe 的真实文档流，与正文由浏览器原生同步滚动。真正的
// 分享弹窗与返回路由仍在可信父页：桥接只接受 Shadow DOM 内 isTrusted 点击，
// 并使用服务端派生的私有 bridge token，上传 HTML 无法伪造平台操作消息。
function reportHeaderBridgeScript(bridgeToken: string): string {
  return `<script>(function(bridgeToken){
  var own=document.currentScript;if(own)own.remove();
  var host=document.querySelector("[data-surge-report-header]");
  if(!host||!host.attachShadow||window.parent===window)return;
  var post=window.parent.postMessage.bind(window.parent);
  var root=host.attachShadow({mode:"open"});
  var configured=false;
  var style=document.createElement("style");
  style.textContent=":host{display:block;width:100%;height:82px;min-height:82px;max-height:82px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}*{box-sizing:border-box}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;width:100%;max-width:1280px;height:82px;margin:0 auto;padding:32px 0 10px}.title{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:32px;font-weight:700;line-height:1.15;letter-spacing:-.02em;color:#1d1d1f}.actions{display:flex;flex:0 0 auto;align-items:center;gap:10px;height:40px}.action{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 16px;border:1px solid rgba(0,0,0,.06);border-radius:999px;background:rgba(255,255,255,.72);color:#6e6e73;font:500 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;white-space:nowrap;cursor:pointer}.action:hover{background:#ededf2;color:#1d1d1f}.action:focus-visible{outline:2px solid #0071e3;outline-offset:2px}.action svg{width:15px;height:15px}.meta{display:flex;height:40px;align-items:center;color:#6e6e73;font-size:13px;white-space:nowrap}";
  root.appendChild(style);
  function icon(kind){var box=document.createElementNS("http://www.w3.org/2000/svg","svg");box.setAttribute("viewBox","0 0 24 24");box.setAttribute("fill","none");box.setAttribute("stroke","currentColor");box.setAttribute("stroke-width","2");box.setAttribute("aria-hidden","true");box.innerHTML=kind==="share"?'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>':'<path d="M15 18l-6-6 6-6"/>';return box}
  function action(kind,label){var button=document.createElement("button");button.type="button";button.className="action";button.appendChild(icon(kind));button.appendChild(document.createTextNode(label));button.addEventListener("click",function(event){if(!event.isTrusted)return;post({__surgeReportHeaderAction:{bridgeToken:bridgeToken,action:kind}},"*")});return button}
  function render(config){if(!config||typeof config!=="object")return;var title=typeof config.title==="string"?config.title.slice(0,160):"";var meta=typeof config.meta==="string"?config.meta.slice(0,160):"";var back=typeof config.backLabel==="string"?config.backLabel.slice(0,24):"";var head=document.createElement("header");head.className="head";var heading=document.createElement("h1");heading.className="title";heading.textContent=title;head.appendChild(heading);var actions=document.createElement("div");actions.className="actions";if(config.share===true)actions.appendChild(action("share","分享"));if(back)actions.appendChild(action("back",back));if(!config.share&&!back&&meta){var info=document.createElement("span");info.className="meta";info.textContent=meta;actions.appendChild(info)}head.appendChild(actions);while(root.childNodes.length>1)root.removeChild(root.lastChild);root.appendChild(head);configured=true}
  window.addEventListener("message",function(event){if(event.source!==window.parent)return;var data=event.data;render(data&&data.__surgeReportHeaderConfig)});
  function ready(){if(!configured)post({__surgeReportHeaderReady:bridgeToken},"*")}
  ready();window.addEventListener("load",ready);setTimeout(ready,250);setTimeout(ready,1000)
})(${JSON.stringify(bridgeToken)});</script>`;
}

const reportHeaderSpacer =
  '<div data-surge-report-header style="display:block!important;position:relative!important;width:100%!important;height:82px!important;min-height:82px!important;max-height:82px!important;flex:0 0 82px!important;margin:0!important;padding:0!important;border:0!important"></div>';

/**
 * 报告入口 HTML 的确定性后处理（与资源路径解析无关，平台约定层面）：
 * 1. 剥离模板自带的报告头（标题 + 返回按钮）：页面统一在上方渲染系统头；
 * 2. 注入 PDF/系统头安全桥接、文档流系统头与滚动条隐藏样式。
 */
export function renderReportDoc(html: string, bridgeToken: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(bridgeToken)) {
    throw new Error("report bridge token is invalid");
  }
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
  if (/<head[^>]*>/i.test(html)) {
    // 桥接脚本放在 head 首位，确保报告自己的点击处理器设置 PDF iframe.src
    // 时观察器已经就绪。
    html = html.replace(
      /<head[^>]*>/i,
      (m) => m + injectStyle + reportPdfBridgeScript(bridgeToken),
    );
  } else {
    html = injectStyle + reportPdfBridgeScript(bridgeToken) + html;
  }
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(
      /<body[^>]*>/i,
      (m) => m + reportHeaderSpacer + reportHeaderBridgeScript(bridgeToken),
    );
  } else {
    html = reportHeaderSpacer + reportHeaderBridgeScript(bridgeToken) + html;
  }
  return html;
}
