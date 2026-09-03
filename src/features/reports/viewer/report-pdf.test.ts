import { describe, expect, it } from "vitest";
import {
  advancePdfLoadState,
  isReportPdfMessage,
  pdfDownloadUrl,
  resolveReportPdfUrl,
} from "@/features/reports/viewer/report-pdf";

describe("报告 PDF 父页桥接", () => {
  const pageHref = "https://surge.example/report/demo";
  const reportSrc = "/r/CAP123/report.html";
  const bridgeToken = "trusted-bridge-token";

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
      isReportPdfMessage(
        { action: "preview", url: "./papers/a.pdf", bridgeToken },
        bridgeToken,
      ),
    ).toBe(true);
    expect(
      isReportPdfMessage({
        action: "download",
        url: "./papers/a.pdf",
        title: "a.pdf",
        bridgeToken,
      }, bridgeToken),
    ).toBe(true);
    expect(
      isReportPdfMessage(
        { action: "preview", url: "./papers/a.pdf", bridgeToken: "forged" },
        bridgeToken,
      ),
    ).toBe(false);
    expect(
      isReportPdfMessage({ action: "open", url: "./a.pdf" }, bridgeToken),
    ).toBe(false);
    expect(
      isReportPdfMessage({ action: "preview", url: 1 }, bridgeToken),
    ).toBe(false);
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

  it("PDF 已就绪后迟到的慢加载 timer 不能让遮罩重新出现", () => {
    expect(advancePdfLoadState("loading", "ready")).toBe("ready");
    expect(advancePdfLoadState("ready", "slow")).toBe("ready");
  });

  it("PDF 加载错误是终态，不会被兜底 timer 伪装成成功", () => {
    expect(advancePdfLoadState("loading", "error")).toBe("error");
    expect(advancePdfLoadState("error", "ready")).toBe("error");
  });

  it("慢加载提示只允许在仍处于 loading 时出现", () => {
    expect(advancePdfLoadState("loading", "slow")).toBe("slow");
    expect(advancePdfLoadState("slow", "slow")).toBe("slow");
  });
});
