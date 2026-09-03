import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportDocCsp, renderReportDoc } from "@/features/reports/serving/render-report-doc";
import {
  applicationOrigin,
  reportDocumentUrl,
  reportsOrigin,
  requestOrigin,
} from "@/features/reports/serving/report-origin";
import {
  issueCapability,
  reportBridgeToken,
  reportResourceEtag,
  requestMatchesEtag,
  verifyCapability,
} from "@/features/reports/report-capability";
import { createHmac } from "crypto";

describe("reportDocCsp", () => {
  it("包含沙箱且只允许 capability 资源、数据、媒体与 Worker", () => {
    const csp = reportDocCsp(
      "https://reports.example/r/CAP123",
      "https://surge.example",
    );
    expect(csp).toContain(
      "sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals",
    );
    expect(csp).toContain(
      "connect-src https://reports.example/r/CAP123/",
    );
    expect(csp).toContain(
      "media-src https://reports.example/r/CAP123/ data: blob:",
    );
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain(
      "worker-src https://reports.example/r/CAP123/ blob:",
    );
    expect(csp).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' https://reports.example/r/CAP123/",
    );
    // 不允许整站 origin（收紧到 /r/<cap>/ 命名空间）
    expect(csp).not.toContain("img-src https://reports.example ");
    expect(csp).toContain("img-src https://reports.example/r/CAP123/ data: blob:");
    expect(csp).toContain("frame-src https://reports.example/r/CAP123/");
    expect(csp).toContain("frame-ancestors https://surge.example");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toMatch(/(?:^|[ ;])https:(?:[ ;]|$)/);
  });
});

describe("报告内容域", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("REPORTS_ORIGIN", "");
  });

  it("优先 x-forwarded-host + proto", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-host": "surge.example", "x-forwarded-proto": "https" },
    });
    expect(requestOrigin(req)).toBe("https://surge.example");
  });

  it("本地 host 缺省 proto 用 http", () => {
    const req = new Request("http://x/", { headers: { host: "localhost:3000" } });
    expect(requestOrigin(req)).toBe("http://localhost:3000");
  });

  it("生产内容域独立于主站并生成绝对 capability URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://surge.example/app");
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.example");
    expect(applicationOrigin()).toBe("https://surge.example");
    expect(reportsOrigin()).toBe("https://reports.example");
    expect(reportDocumentUrl("CAP.123")).toBe(
      "https://reports.example/r/CAP.123/report.html",
    );
  });

  it("请求 origin 只取可信反代头，不被应用配置覆盖", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://surge.example/app");
    const req = new Request("http://x/", {
      headers: { "x-forwarded-host": "evil.example" },
    });
    expect(requestOrigin(req)).toBe("http://evil.example");
  });
});

describe("report capability", () => {
  it("签发-验证往返，携带报告、世代与纪元", () => {
    const cap = issueCapability("r-123", "rev-abc", 3);
    const grant = verifyCapability(cap);
    expect(grant).not.toBeNull();
    expect(grant!.reportId).toBe("r-123");
    expect(grant!.revisionId).toBe("rev-abc");
    expect(grant!.epoch).toBe(3);
    expect(grant!.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it("capability URL 安全（可直接作路径段）", () => {
    const cap = issueCapability("r-123", "rev-abc", 0);
    expect(cap).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("为每个 capability 派生稳定且相互隔离的 bridge token", () => {
    const first = issueCapability("r-123", "rev-abc", 0);
    const second = issueCapability("r-456", "rev-abc", 0);
    expect(reportBridgeToken(first)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reportBridgeToken(first)).toBe(reportBridgeToken(first));
    expect(reportBridgeToken(first)).not.toBe(reportBridgeToken(second));
  });

  it("同一小时窗内签发稳定 URL，便于返回时复用私有缓存", () => {
    const hour = 1_800_000_000 * 1000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(hour + 5 * 60 * 1000);
    const first = issueCapability("r-123", "rev-abc", 0);
    spy.mockReturnValue(hour + 55 * 60 * 1000);
    expect(issueCapability("r-123", "rev-abc", 0)).toBe(first);
    spy.mockReturnValue(hour + 65 * 60 * 1000);
    expect(issueCapability("r-123", "rev-abc", 0)).not.toBe(first);
  });

  it("到期上限 clamp：capability 不活过分享截止时间", () => {
    const soon = Math.floor(Date.now() / 1000) + 60;
    const cap = issueCapability("r-123", "rev-abc", 0, soon);
    expect(verifyCapability(cap)!.expiresAt).toBe(soon);
  });

  it("篡改签名验证失败", () => {
    const cap = issueCapability("r-123", "rev-abc", 0);
    expect(verifyCapability(cap + "x")).toBeNull();
    expect(verifyCapability("x" + cap)).toBeNull();
    expect(verifyCapability("")).toBeNull();
    expect(verifyCapability("onlypayload")).toBeNull();
  });

  it("在解码与验签前拒绝异常长度或字符的 capability", () => {
    expect(verifyCapability(`${"A".repeat(513)}.sig`)).toBeNull();
    expect(verifyCapability("payload.%invalid")).toBeNull();
  });

  it("过期 capability 验证失败", () => {
    const cap = issueCapability("r-123", "rev-abc", 0);
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7 * 60 * 60 * 1000);
    expect(verifyCapability(cap)).toBeNull();
    spy.mockRestore();
  });

  it("伪造 payload（换报告 ID / 换纪元）验证失败", () => {
    const cap = issueCapability("r-123", "rev-abc", 5);
    const dot = cap.indexOf(".");
    for (const payload of [
      "v1.read.r-456.rev-abc.5.9999999999",
      "v1.read.r-123.rev-abc.6.9999999999",
    ]) {
      const forged =
        Buffer.from(payload).toString("base64url") + cap.slice(dot);
      expect(verifyCapability(forged)).toBeNull();
    }
  });

  it("密钥隔离：派生密钥不同于主密钥直接签名", () => {
    const cap = issueCapability("r-123", "rev-abc", 0);
    const payload =
      "v1.read.r-123.rev-abc.0." +
      verifyCapability(cap)!.expiresAt;
    const directSig = createHmac(
      "sha256",
      process.env.BETTER_AUTH_SECRET!,
    )
      .update(payload)
      .digest("base64url");
    expect(cap.endsWith(directSig)).toBe(false);
  });
});

describe("报告资源私有缓存", () => {
  it("ETag 对同一资源稳定，内容世代或文件信息变化时轮换", () => {
    const etag = reportResourceEtag("rev-a", "images/a.webp", 123, 456);
    expect(reportResourceEtag("rev-a", "images/a.webp", 123, 456)).toBe(etag);
    expect(reportResourceEtag("rev-b", "images/a.webp", 123, 456)).not.toBe(etag);
    expect(reportResourceEtag("rev-a", "images/a.webp", 124, 456)).not.toBe(etag);
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
  });

  it("识别 If-None-Match 列表、弱校验器与通配符", () => {
    const etag = reportResourceEtag("rev-a", "images/a.webp", 123, 456);
    expect(requestMatchesEtag(null, etag)).toBe(false);
    expect(requestMatchesEtag(`"other", ${etag}`, etag)).toBe(true);
    expect(requestMatchesEtag(`W/${etag}`, etag)).toBe(true);
    expect(requestMatchesEtag("*", etag)).toBe(true);
  });
});

describe("renderReportDoc", () => {
  const bridgeToken = "A".repeat(43);
  const base = `<!DOCTYPE html><html><head><title>t</title></head><body><header class="rpt-head"><h1>标题</h1></header>%s</body></html>`;
  const run = (inner: string) =>
    renderReportDoc(base.replace("%s", inner), bridgeToken);

  it("其余相对引用原样保留（浏览器原生解析）", () => {
    const out = run(
      `<script src="data.js"></script><img src="images/a.png"><link href="style.css" rel="stylesheet">`,
    );
    expect(out).toContain(`src="data.js"`);
    expect(out).toContain(`src="images/a.png"`);
    expect(out).toContain(`href="style.css"`);
  });

  it("剥离 rpt-head 头部", () => {
    const out = run("");
    expect(out).not.toContain("rpt-head");
    expect(out).not.toContain("<h1>标题</h1>");
  });

  it("注入真实视口所需的滚动条样式与文档流系统头安全桥接", () => {
    const out = run("");
    const headPos = out.indexOf("<head>");
    const stylePos = out.indexOf("scrollbar-width:none");
    expect(stylePos).toBeGreaterThan(headPos);
    expect(stylePos).toBeLessThan(out.indexOf("</head>"));
    expect(out).not.toContain("__surgeReportHeight");
    expect(out).toContain("data-surge-report-header");
    expect(out).toContain("__surgeReportHeaderReady");
    expect(out).toContain("__surgeReportHeaderAction");
    expect(out).toContain("event.isTrusted");
    expect(out).toContain("document.currentScript");
    expect(out).toContain("bridgeToken:bridgeToken");
  });

  it("在报告脚本之前注入 PDF 桥接，拦截下载链接与 iframe 预览", () => {
    const marker = '<script id="report-script"></script>';
    const out = run(marker);
    const bridgePos = out.indexOf("__surgeReportPdf");
    expect(bridgePos).toBeGreaterThan(out.indexOf("<head>"));
    expect(bridgePos).toBeLessThan(out.indexOf(marker));
    expect(out).toContain('link.hasAttribute("download")');
    expect(out).toContain('link.relList.add("noopener")');
    expect(out).toContain('link.relList.add("noreferrer")');
    expect(out).toContain("target instanceof HTMLIFrameElement");
    expect(out).toContain('frame.setAttribute("src","about:blank")');
  });

  it("拒绝把非服务端派生值注入桥接脚本", () => {
    expect(() => renderReportDoc(base, "unsafe</script>")).toThrow(
      "report bridge token is invalid",
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
