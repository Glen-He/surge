import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportDocCsp, requestOrigin, renderReportDoc } from "@/lib/report-pipeline";
import { issueCapability, verifyCapability } from "@/lib/report-capability";
import { createHmac } from "crypto";

describe("reportDocCsp", () => {
  it("包含沙箱、断网与 base-uri/worker 禁用，资源仅限 capability 前缀", () => {
    const csp = reportDocCsp("https://surge.example/r/CAP123");
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain(
      "script-src 'unsafe-inline' https://surge.example/r/CAP123/",
    );
    // 不允许整站 origin（收紧到 /r/<cap>/ 命名空间）
    expect(csp).not.toContain("img-src https://surge.example ");
    expect(csp).toContain("img-src https://surge.example/r/CAP123/ data: blob:");
  });
});

describe("requestOrigin", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
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

  it("部署固定 origin 优先于可伪造请求头", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://reports.example/app");
    const req = new Request("http://x/", {
      headers: { "x-forwarded-host": "evil.example" },
    });
    expect(requestOrigin(req)).toBe("https://reports.example");
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
      process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET ?? "surge-dev-asset-secret",
    )
      .update(payload)
      .digest("base64url");
    expect(cap.endsWith(directSig)).toBe(false);
  });
});

describe("renderReportDoc", () => {
  const base = `<!DOCTYPE html><html><head><title>t</title></head><body><header class="rpt-head"><h1>标题</h1></header>%s</body></html>`;
  const run = (inner: string) => renderReportDoc(base.replace("%s", inner));

  it("旧约定公共库路径映射到 ./_platform/", () => {
    expect(run(`<script src="../../lib/echarts.min.js"></script>`)).toContain(
      `src="./_platform/echarts.min.js"`,
    );
    expect(run(`<script src="../lib/echarts.min.js"></script>`)).toContain(
      `src="./_platform/echarts.min.js"`,
    );
  });

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

  it("注入滚动条隐藏样式于 <head> 首位、高度上报脚本于 </body> 前", () => {
    const out = run("");
    const headPos = out.indexOf("<head>");
    const stylePos = out.indexOf("scrollbar-width:none");
    const bodyPos = out.lastIndexOf("</body>");
    const scriptPos = out.indexOf("__surgeReportHeight");
    expect(stylePos).toBeGreaterThan(headPos);
    expect(stylePos).toBeLessThan(out.indexOf("</head>"));
    expect(scriptPos).toBeGreaterThan(0);
    expect(scriptPos).toBeLessThan(bodyPos);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
