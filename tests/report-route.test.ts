import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const mocked = vi.hoisted(() => ({ reportRoot: "" }));

vi.mock("@/lib/db", () => ({
  db: {
    query: vi.fn(async () => ({
      rows: [
        {
          user_id: "user-1",
          slug: "report-1",
          revision_id: "rev-1",
          capability_epoch: 0,
          template_key: null,
          storage_key: "a_0123456789abcdef0123456789abcdef",
        },
      ],
    })),
  },
}));

vi.mock("@/lib/report-storage", () => ({
  reportContentDir: vi.fn(() => mocked.reportRoot),
}));

import { GET } from "@/app/r/[cap]/[...path]/route";
import { issueCapability } from "@/lib/report-capability";

describe("报告资源路由缓存", () => {
  let root: string;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://surge.example");
    vi.stubEnv("REPORTS_ORIGIN", "https://surge.example");
    root = await mkdtemp(path.join(os.tmpdir(), "surge-report-route-"));
    mocked.reportRoot = root;
    await mkdir(path.join(root, "images"));
    await writeFile(path.join(root, "images", "a.webp"), Buffer.from("webp-data"));
    await writeFile(path.join(root, "paper.pdf"), Buffer.from("pdf-data"));
    await writeFile(path.join(root, "clip.mp4"), Buffer.from("video-data"));
    await writeFile(
      path.join(root, "report.html"),
      "<!doctype html><html><head></head><body>report</body></html>",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function request(
    cap: string,
    segments: string[],
    headers?: HeadersInit,
    search = "",
  ) {
    return GET(new Request(`https://surge.example/r/${cap}/${segments.join("/")}${search}`, { headers }), {
      params: Promise.resolve({ cap, path: segments }),
    });
  }

  it("子资源流式返回私有重验证头和 ETag", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const response = await request(cap, ["images", "a.webp"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, must-revalidate",
    );
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(response.headers.get("content-length")).toBe("9");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("webp-data");
  });

  it("ETag 命中在完成权限校验后返回 304", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const first = await request(cap, ["images", "a.webp"]);
    const etag = first.headers.get("etag");
    await first.body?.cancel();

    const response = await request(cap, ["images", "a.webp"], {
      "If-None-Match": etag!,
    });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("入口 HTML 仍禁止存储", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const response = await request(cap, ["report.html"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors https://surge.example",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    const html = await response.text();
    expect(html).not.toContain("__surgeReportHeight");
    expect(html).toContain("__surgeReportHeaderReady");
    expect(html).toContain("data-surge-report-header");
  });

  it("子资源保留 CORS，供 opaque-origin 汇报加载 ES Module 等资源", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const response = await request(cap, ["images", "a.webp"]);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await response.body?.cancel();
  });

  it("入口阻止外部网络且包内媒体使用正确 MIME", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const entry = await request(cap, ["report.html"]);
    const csp = entry.headers.get("content-security-policy")!;
    expect(csp).toMatch(/connect-src https:\/\/surge\.example\/r\/[^;]+\//);
    expect(csp).toMatch(/frame-src https:\/\/surge\.example\/r\/[^;]+\//);
    expect(csp).not.toMatch(/(?:^|[ ;])https:(?:[ ;]|$)/);
    expect(csp).toContain("form-action 'none'");

    const media = await request(cap, ["clip.mp4"]);
    expect(media.headers.get("content-type")).toBe("video/mp4");
    await media.body?.cancel();
  });

  it("拒绝从主站 origin 直接读取 capability 资源", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://surge.example");
    vi.stubEnv("REPORTS_ORIGIN", "https://reports.example");
    const cap = issueCapability("report-id", "rev-1", 0);
    const response = await request(cap, ["report.html"]);
    expect(response.status).toBe(404);
  });

  it("PDF iframe 请求保持 inline，显式下载参数稳定返回 attachment", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const preview = await request(cap, ["paper.pdf"], {
      "Sec-Fetch-Dest": "iframe",
    });
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    expect(preview.headers.get("content-disposition")).toBeNull();
    await preview.body?.cancel();

    const download = await request(
      cap,
      ["paper.pdf"],
      { "Sec-Fetch-Dest": "iframe" },
      "?__surge_download=1",
    );
    expect(download.headers.get("content-disposition")).toBe("attachment");
    await download.body?.cancel();
  });

  it("顶层打开 PDF 不会被误判成下载", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const response = await request(cap, ["paper.pdf"], {
      "Sec-Fetch-Dest": "document",
    });
    expect(response.headers.get("content-disposition")).toBeNull();
    await response.body?.cancel();
  });

  it("大文件支持单段 Range，并拒绝越界范围", async () => {
    const cap = issueCapability("report-id", "rev-1", 0);
    const partial = await request(cap, ["paper.pdf"], { Range: "bytes=0-2" });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("accept-ranges")).toBe("bytes");
    expect(partial.headers.get("content-range")).toBe("bytes 0-2/8");
    expect(await partial.text()).toBe("pdf");

    const invalid = await request(cap, ["paper.pdf"], { Range: "bytes=99-100" });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */8");
  });
});
