"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import {
  REPORT_PDF_MESSAGE_KEY,
  isReportPdfMessage,
  pdfDownloadUrl,
  resolveReportPdfUrl,
} from "@/lib/report-pdf";
import { REPORT_SANDBOX_TOKENS } from "@/lib/report-security";

type PdfPreview = { url: string; title: string };

/**
 * 报告沙箱 iframe（登录态查看页与分享页共用）。
 *
 * 查看器占据系统头以下的剩余视口，报告在 iframe 内自行滚动。完整 HTML
 * 因而保有正常的 fixed/sticky/100vh 语义，不需要平台识别报告内部弹层。
 */
export function ReportFrame({ src, title }: { src: string; title: string }) {
  const [pdfPreview, setPdfPreview] = useState<PdfPreview | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const el = iframeRef.current;
      // 只信来自自己 iframe 窗口的消息（sandbox 下 origin 为 null，用 source 引用判等）
      if (!el || e.source !== el.contentWindow) return;
      const data = e.data as
        | {
            [REPORT_PDF_MESSAGE_KEY]?: unknown;
          }
        | null;
      const message = data?.[REPORT_PDF_MESSAGE_KEY];
      if (!isReportPdfMessage(message)) return;
      const resource = resolveReportPdfUrl(src, message.url, window.location.href);
      if (!resource) return;

      if (message.action === "preview") {
        setPdfPreview({
          url: resource.href,
          title: message.title?.trim().slice(0, 160) || "PDF 预览",
        });
        return;
      }

      const link = document.createElement("a");
      link.href = pdfDownloadUrl(resource);
      link.download = "";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [src]);

  // sandbox 补充：
  // - allow-downloads：保留报告内非 PDF 附件的原生下载能力；PDF 由父页桥接
  // - allow-popups + escape：放行 target="_blank" 外链（DOI/PMID 等），
  //   新标签页脱离沙箱以正常加载外部站点（不回授报告脚本任何权限）
  // - allow-modals：保留网页对话框语义；表单提交仍被 CSP 禁止
  return (
    <>
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        sandbox={REPORT_SANDBOX_TOKENS}
        allow="clipboard-write; fullscreen"
        allowFullScreen
        className="report-frame"
      />
      <Modal
        open={pdfPreview !== null}
        onClose={() => setPdfPreview(null)}
        title={pdfPreview?.title ?? "PDF 预览"}
        plainHeader
        wide
      >
        {pdfPreview && (
          <iframe
            src={pdfPreview.url}
            title={pdfPreview.title}
            className="report-pdf-preview"
          />
        )}
      </Modal>
    </>
  );
}
