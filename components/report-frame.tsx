"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 报告沙箱 iframe（登录态查看页与分享页共用）。
 *
 * 外层页面整体滚动（系统头随内容一起滚走），iframe 必须自适应报告的
 * 真实内容高度 —— 报告文档由管线注入的高度上报脚本 postMessage 通知，
 * 本组件监听并撑高 iframe（opaque origin 无法直接读 contentDocument）。
 * 收不到消息的兜底：维持首屏高度 calc(100vh - 118px)。
 */
export function ReportFrame({ src, title }: { src: string; title: string }) {
  const [height, setHeight] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const el = iframeRef.current;
      // 只信来自自己 iframe 窗口的消息（sandbox 下 origin 为 null，用 source 引用判等）
      if (!el || e.source !== el.contentWindow) return;
      const h = (e.data as { __surgeReportHeight?: unknown } | null)?.__surgeReportHeight;
      if (typeof h === "number" && Number.isFinite(h) && h > 0) {
        // +1px 避免亚像素舍入触发 iframe 内部滚动条
        setHeight(Math.min(Math.ceil(h) + 1, 100000));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // sandbox 补充：
  // - allow-downloads：放行报告内 <a download> 下载（如参考文献 PDF）
  // - allow-popups + escape：放行 target="_blank" 外链（DOI/PMID 等），
  //   新标签页脱离沙箱以正常加载外部站点（不回授报告脚本任何权限）
  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      sandbox="allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox"
      className="block w-full shrink-0 border-0 bg-transparent"
      style={{
        height: height !== null ? `${height}px` : "calc(100vh - 118px)",
        minHeight: 480,
      }}
    />
  );
}
