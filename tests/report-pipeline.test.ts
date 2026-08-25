import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reportDocCsp,
  requestOrigin,
  rewriteReportHtml,
  signedAssetUrl,
  verifyAssetSig,
} from "@/lib/report-pipeline";

const OPTS = { assetUrl: (p: string) => `/asset?p=${encodeURIComponent(p)}` };

describe("reportDocCsp", () => {
  it("包含沙箱与断网指令，资源仅限指定 origin", () => {
    const csp = reportDocCsp("https://surge.example");
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline' https://surge.example");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("requestOrigin", () => {
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
});

describe("资产 URL 签名", () => {
  it("签名-验签往返", () => {
    const url = signedAssetUrl("demo/data.js", "user1");
    const u = new URL(`http://x${url}`);
    expect(
      verifyAssetSig(
        u.searchParams.get("p")!,
        u.searchParams.get("u")!,
        Number(u.searchParams.get("e")),
        u.searchParams.get("t")!,
      ),
    ).toBe(true);
  });

  it("篡改路径验签失败", () => {
    const url = signedAssetUrl("demo/data.js", "user1");
    const u = new URL(`http://x${url}`);
    expect(
      verifyAssetSig(
        "other/file.js",
        u.searchParams.get("u")!,
        Number(u.searchParams.get("e")),
        u.searchParams.get("t")!,
      ),
    ).toBe(false);
  });

  it("过期签名失败", () => {
    const url = signedAssetUrl("demo/data.js", "user1");
    const u = new URL(`http://x${url}`);
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    expect(
      verifyAssetSig(
        u.searchParams.get("p")!,
        u.searchParams.get("u")!,
        Number(u.searchParams.get("e")),
        u.searchParams.get("t")!,
      ),
    ).toBe(false);
    spy.mockRestore();
  });

  it("缺参验签失败", () => {
    expect(verifyAssetSig("", "u", 1, "t")).toBe(false);
    expect(verifyAssetSig("p", "", 1, "t")).toBe(false);
    expect(verifyAssetSig("p", "u", NaN, "t")).toBe(false);
  });
});

describe("rewriteReportHtml", () => {
  const base = `<!DOCTYPE html><html><head><title>t</title></head><body><header class="rpt-head"><h1>标题</h1></header>%s</body></html>`;
  const run = (inner: string) =>
    rewriteReportHtml(base.replace("%s", inner), "demo", OPTS);

  it("公共库 ../../lib/ → _shared/ 资产端点", () => {
    const out = run(`<script src="../../lib/echarts.min.js"></script>`);
    expect(out).toContain(`/asset?p=${encodeURIComponent("_shared/echarts.min.js")}`);
  });

  it("项目内相对 .js 重写到 slug 前缀", () => {
    const out = run(`<script src="data.js"></script>`);
    expect(out).toContain(`/asset?p=${encodeURIComponent("demo/data.js")}`);
  });

  it("绝对路径与外链脚本不重写", () => {
    const out = run(`<script src="/abs/a.js"></script><script src="https://cdn.x/a.js"></script>`);
    expect(out).toContain('src="/abs/a.js"');
    expect(out).toContain('src="https://cdn.x/a.js"');
  });

  it("静态资源（img/link）统一重写到资产端点", () => {
    const out = run(`<img src="chart.png"><link href="style.css" rel="stylesheet">`);
    expect(out).toContain(`/asset?p=${encodeURIComponent("demo/chart.png")}`);
    expect(out).toContain(`/asset?p=${encodeURIComponent("demo/style.css")}`);
  });

  it("<style> 块内 url()/@import 重写，正文文本不误伤", () => {
    const out = run(
      `<style>body{background:url(bg.png)}@import "x.css";</style><p>url(no.png)</p>`,
    );
    expect(out).toContain(`/asset?p=${encodeURIComponent("demo/bg.png")}`);
    expect(out).toContain(`<p>url(no.png)</p>`);
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
});
