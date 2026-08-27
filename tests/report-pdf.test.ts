import { describe, expect, it } from "vitest";
import {
  isReportPdfMessage,
  pdfDownloadUrl,
  resolveReportPdfUrl,
} from "@/lib/report-pdf";

describe("报告 PDF 父页桥接", () => {
  const pageHref = "https://surge.example/report/demo";
  const reportSrc = "/r/CAP123/report.html";

  it("只接受当前 capability 目录内的 PDF", () => {
    expect(
      resolveReportPdfUrl(
        reportSrc,
        "https://surge.example/r/CAP123/papers/a.pdf#page=2",
        pageHref,
      )?.href,
    ).toBe("https://surge.example/r/CAP123/papers/a.pdf");
    expect(
      resolveReportPdfUrl(reportSrc, "./papers/A.PDF", pageHref)?.href,
    ).toBe("https://surge.example/r/CAP123/papers/A.PDF");
  });

  it("拒绝跨源、越出 capability 与非 PDF 目标", () => {
    expect(
      resolveReportPdfUrl(reportSrc, "https://evil.example/a.pdf", pageHref),
    ).toBeNull();
    expect(
      resolveReportPdfUrl(reportSrc, "/r/OTHER/a.pdf", pageHref),
    ).toBeNull();
    expect(
      resolveReportPdfUrl(reportSrc, "/api/private.pdf", pageHref),
    ).toBeNull();
    expect(
      resolveReportPdfUrl(reportSrc, "./papers/a.html", pageHref),
    ).toBeNull();
  });

  it("识别严格的预览/下载消息", () => {
    expect(
      isReportPdfMessage({ action: "preview", url: "./papers/a.pdf" }),
    ).toBe(true);
    expect(
      isReportPdfMessage({
        action: "download",
        url: "./papers/a.pdf",
        title: "a.pdf",
      }),
    ).toBe(true);
    expect(isReportPdfMessage({ action: "open", url: "./a.pdf" })).toBe(false);
    expect(isReportPdfMessage({ action: "preview", url: 1 })).toBe(false);
  });

  it("下载 URL 保留既有查询参数并添加显式 disposition 标记", () => {
    const url = new URL(
      "https://surge.example/r/CAP123/papers/a.pdf?page=2#section",
    );
    expect(pdfDownloadUrl(url)).toBe(
      "https://surge.example/r/CAP123/papers/a.pdf?page=2&__surge_download=1#section",
    );
    expect(url.searchParams.has("__surge_download")).toBe(false);
  });
});
