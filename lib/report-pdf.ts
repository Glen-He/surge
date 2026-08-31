export const REPORT_PDF_MESSAGE_KEY = "__surgeReportPdf";
export const REPORT_PDF_DOWNLOAD_PARAM = "__surge_download";

type ReportPdfAction = "preview" | "download";

export type ReportPdfMessage = {
  action: ReportPdfAction;
  url: string;
  title?: string;
};

/**
 * Treat every message from uploaded report HTML as untrusted. A PDF action may
 * only target a .pdf resource inside the exact capability directory that
 * supplied report.html; it cannot turn the trusted parent into a same-origin
 * navigation/download gadget for the rest of the application.
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

export function isReportPdfMessage(value: unknown): value is ReportPdfMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ReportPdfMessage>;
  return (
    (message.action === "preview" || message.action === "download") &&
    typeof message.url === "string" &&
    (message.title === undefined || typeof message.title === "string")
  );
}

export function pdfDownloadUrl(url: URL): string {
  const downloadUrl = new URL(url);
  downloadUrl.searchParams.set(REPORT_PDF_DOWNLOAD_PARAM, "1");
  return downloadUrl.href;
}
