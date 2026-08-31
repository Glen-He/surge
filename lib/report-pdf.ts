export const REPORT_PDF_MESSAGE_KEY = "__surgeReportPdf";
export const REPORT_PDF_DOWNLOAD_PARAM = "__surge_download";

type ReportPdfAction = "preview" | "download";

export type ReportPdfMessage = {
  action: ReportPdfAction;
  url: string;
  title?: string;
  bridgeToken: string;
};

export type PdfLoadState = "loading" | "slow" | "ready" | "error";
export type PdfLoadEvent = "slow" | "ready" | "error";

/**
 * PDF 加载状态只能从进行中状态走向终态，不能由迟到的 timer/event
 * 把已经可见的阅读器重新盖住，也不能把明确的加载错误伪装成成功。
 */
export function advancePdfLoadState(
  state: PdfLoadState,
  event: PdfLoadEvent,
): PdfLoadState {
  if (state === "ready" || state === "error") return state;
  if (event === "slow") return state === "loading" ? "slow" : state;
  return event;
}

/**
 * 上传的报告 HTML 发来的消息一律视为不可信。PDF 动作只能指向
 * 提供 report.html 的同一 capability 目录内的 .pdf 资源，
 * 不能把可信父页面变成针对应用其余部分的同源导航/下载跳板。
 */
export function resolveReportPdfUrl(
  reportSrc: string,
  candidate: string,
  pageHref: string,
): URL | null {
  try {
    const reportUrl = new URL(reportSrc, pageHref);
    const resourceUrl = new URL(candidate, reportUrl);
    const reportRoot = reportUrl.pathname.slice(
      0,
      reportUrl.pathname.lastIndexOf("/") + 1,
    );

    if (
      resourceUrl.origin !== reportUrl.origin ||
      !resourceUrl.pathname.startsWith(reportRoot) ||
      !resourceUrl.pathname.toLowerCase().endsWith(".pdf")
    ) {
      return null;
    }

    resourceUrl.hash = "";
    return resourceUrl;
  } catch {
    return null;
  }
}

export function isReportPdfMessage(
  value: unknown,
  expectedBridgeToken: string,
): value is ReportPdfMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ReportPdfMessage>;
  return (
    (message.action === "preview" || message.action === "download") &&
    typeof message.url === "string" &&
    (message.title === undefined || typeof message.title === "string") &&
    message.bridgeToken === expectedBridgeToken
  );
}

export function pdfDownloadUrl(url: URL): string {
  const downloadUrl = new URL(url);
  downloadUrl.searchParams.set(REPORT_PDF_DOWNLOAD_PARAM, "1");
  return downloadUrl.href;
}
