"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import {
  REPORT_PDF_MESSAGE_KEY,
  isReportPdfMessage,
  pdfDownloadUrl,
  resolveReportPdfUrl,
} from "@/lib/report-pdf";
import { REPORT_SHARE_REQUEST_EVENT } from "@/lib/report-header";
import { REPORT_SANDBOX_TOKENS } from "@/lib/report-security";

type PdfPreview = { url: string; title: string };
type PdfLoadState = "loading" | "slow" | "ready" | "error";

/**
 * 报告沙箱 iframe（登录态查看页与分享页共用）。
 *
 * 报告始终在系统头以下的独立视口内滚动。不能把 iframe 撑到正文高度：
 * 那会让报告内的 position:fixed、vh、sticky 与 IntersectionObserver 误把
 * 整篇正文当成浏览器视口，破坏普通 HTML 在本地运行时的布局语义。
 */
export function ReportFrame({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  const [pdfPreview, setPdfPreview] = useState<PdfPreview | null>(null);
  const [pdfLoadState, setPdfLoadState] =
    useState<PdfLoadState>("loading");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const reportHeaderNonceRef = useRef("");

  const sendReportHeaderConfig = useCallback((el: HTMLIFrameElement) => {
    const shell = el.closest<HTMLElement>(".report-viewer-shell");
    const header = shell?.querySelector<HTMLElement>(".rpt-sys-head");
    if (!header || !el.contentWindow) return;
    const share = header.querySelector("[data-report-share-trigger]") !== null;
    const back = header.querySelector<HTMLAnchorElement>("a.rpt-sys-back");
    const meta = !share && !back ? header.querySelector("span")?.textContent : "";
    el.contentWindow.postMessage(
      {
        __surgeReportHeaderConfig: {
          title: header.querySelector(".rpt-sys-title")?.textContent?.trim() || title,
          share,
          backLabel: back?.textContent?.trim() || "",
          meta: meta?.trim() || "",
        },
      },
      "*",
    );
  }, [title]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const el = iframeRef.current;
      // 只信来自自己 iframe 窗口的消息（sandbox 下 origin 为 null，用 source 引用判等）
      if (!el || e.source !== el.contentWindow) return;
      const data = e.data as
        | {
            [REPORT_PDF_MESSAGE_KEY]?: unknown;
            __surgeReportHeaderReady?: unknown;
            __surgeReportHeaderAction?: unknown;
          }
        | null;

      const readyNonce = data?.__surgeReportHeaderReady;
      if (typeof readyNonce === "string" && /^[a-f0-9]{32}$/.test(readyNonce)) {
        reportHeaderNonceRef.current = readyNonce;
        sendReportHeaderConfig(el);
      }

      const headerAction = data?.__surgeReportHeaderAction;
      if (
        headerAction &&
        typeof headerAction === "object" &&
        "nonce" in headerAction &&
        "action" in headerAction &&
        headerAction.nonce === reportHeaderNonceRef.current
      ) {
        if (headerAction.action === "share") {
          window.dispatchEvent(new Event(REPORT_SHARE_REQUEST_EVENT));
        } else if (headerAction.action === "back") {
          el.closest(".report-viewer-shell")
            ?.querySelector<HTMLAnchorElement>("a.rpt-sys-back")
            ?.click();
        }
      }

      const message = data?.[REPORT_PDF_MESSAGE_KEY];
      if (!isReportPdfMessage(message)) return;
      const resource = resolveReportPdfUrl(src, message.url, window.location.href);
      if (!resource) return;

      if (message.action === "preview") {
        setPdfLoadState("loading");
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
  }, [sendReportHeaderConfig, src]);

  useEffect(() => {
    if (!pdfPreview) return;
    const slowTimer = window.setTimeout(() => setPdfLoadState("slow"), 2500);
    // 内置 PDF 阅读器在 Chromium/WebKit 中都不保证触发 iframe load。
    // 最迟四秒后露出阅读器自身界面，避免加载提示永久遮住已可交互的 PDF。
    const revealTimer = window.setTimeout(() => setPdfLoadState("ready"), 4000);

    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(revealTimer);
    };
  }, [pdfPreview]);

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
        onLoad={(event) => sendReportHeaderConfig(event.currentTarget)}
      />
      <Modal
        open={pdfPreview !== null}
        onClose={() => setPdfPreview(null)}
        title={pdfPreview?.title ?? "PDF 预览"}
        plainHeader
        wide
      >
        {pdfPreview && (
          <div className="report-pdf-shell">
            <iframe
              key={pdfPreview.url}
              src={pdfPreview.url}
              title={pdfPreview.title}
              className={`report-pdf-preview${
                pdfLoadState === "ready" ? " report-pdf-preview--ready" : ""
              }`}
              onLoad={() =>
                window.setTimeout(() => setPdfLoadState("ready"), 800)
              }
              onError={() => setPdfLoadState("error")}
            />
            {pdfLoadState !== "ready" && (
              <div className="report-pdf-loading" role="status" aria-live="polite">
                {pdfLoadState === "error" ? (
                  <>
                    <p>PDF 加载失败</p>
                    <span>请关闭后重试，或返回汇报下载文件查看</span>
                  </>
                ) : (
                  <>
                    <span className="report-pdf-spinner" aria-hidden />
                    <p>
                      {pdfLoadState === "slow"
                        ? "PDF 较大，仍在加载…"
                        : "正在加载 PDF…"}
                    </p>
                    <span>首次打开可能需要数秒</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
