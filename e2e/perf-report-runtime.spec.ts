import { expect, test, type BrowserContext, type FrameLocator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportArtifactDir } from "@/lib/report-storage";
import {
  encryptShareToken,
  shareTokenHash,
} from "@/lib/share-token-store";
import { generateShareToken } from "@/lib/shares";

// ── 报告运行时性能测量专用（PERF_RUN=1 才运行）──
//
// 场景与用户验收清单对齐：
//   A 冷缓存第一次打开 report-02（图表 + data.js + 3Dmol）
//   B 同会话打开第二份 ECharts 报告（2026-08-17/report-01）
//   C 返回 report-02
//   D 图表就绪后不滚动，3Dmol 请求计数
//   E 滚动到 3D 区域后的 3Dmol 请求计数
// 仅测量当前架构（defer 平台脚本 + data.js defer + 3Dmol 懒加载）；
// 与改造前形态的对比数据以迁移前的历史实测记录为准（见
// tmp/platform-url-migration.md）。

test.skip(!process.env.PERF_RUN, "性能测量专用：PERF_RUN=1 触发");

type PerfFixture = {
  slug: string;
  storageKey: string;
  token: string;
  revisionId: string;
  title: string;
};

const fixture = {
  userId: "",
  context: undefined as BrowserContext | undefined,
  reportA: {
    slug: `perf_${randomUUID().slice(0, 8)}`,
    storageKey: `a_${randomUUID().replaceAll("-", "")}`,
    token: generateShareToken(),
    revisionId: randomUUID(),
    title: "P15 两条序列优化阶段性结果",
  } satisfies PerfFixture,
  reportB: {
    slug: `perf_${randomUUID().slice(0, 8)}`,
    storageKey: `a_${randomUUID().replaceAll("-", "")}`,
    token: generateShareToken(),
    revisionId: randomUUID(),
    title: "线性肽 KTTKS 膜内扩散系数分析",
  } satisfies PerfFixture,
};

// upload.md 打包口径：zip 不含 echarts.min.js（平台内置）、source/、.DS_Store
async function copyReportFiles(
  sourceDir: string,
  targetDir: string,
): Promise<number> {
  await fs.mkdir(targetDir, { recursive: true });
  let total = 0;
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "echarts.min.js" ||
      entry.name === ".DS_Store" ||
      entry.name === "source"
    ) {
      continue;
    }
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      total += await copyReportFiles(from, to);
    } else {
      await fs.copyFile(from, to);
      total += (await fs.stat(from)).size;
    }
  }
  return total;
}

async function installReport(
  report: PerfFixture,
  sourceDir: string,
  title: string,
): Promise<void> {
  const targetDir = reportArtifactDir(fixture.userId, report.storageKey);
  const sizeBytes = await copyReportFiles(sourceDir, targetDir);

  await db.query(
    `INSERT INTO reports
       (id, user_id, slug, revision_id, title, date, tag, description, keywords,
        size_bytes, storage_key, template_key)
     VALUES ($1, $2, $3, $4, $5, '2026-09-02', '', '', '', $6, $7, NULL)`,
    [
      randomUUID(),
      fixture.userId,
      report.slug,
      report.revisionId,
      title,
      sizeBytes,
      report.storageKey,
    ],
  );
  await db.query(
    `INSERT INTO report_shares (id, report_id, token_hash, token_enc)
     VALUES ($1, $2, $3, $4)`,
    [
      randomUUID(),
      (
        await db.query<{ id: string }>(
          `SELECT id FROM reports WHERE slug = $1 AND user_id = $2`,
          [report.slug, fixture.userId],
        )
      ).rows[0]!.id,
      shareTokenHash(report.token),
      encryptShareToken(report.token),
    ],
  );
}

test.beforeAll(async ({ browser }) => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    {
      name: "E2E Perf Baseline",
      email: `perf-${randomUUID()}@example.test`,
      emailVerified: true,
    },
    { method: "test" },
  );
  fixture.userId = user.id;

  const checkout = process.cwd();
  await installReport(
    fixture.reportA,
    path.join(checkout, "reports_local", "2026-08-28", "report-02"),
    fixture.reportA.title,
  );
  await installReport(
    fixture.reportB,
    path.join(checkout, "reports_local", "2026-08-17", "report-01"),
    fixture.reportB.title,
  );

  // 单一浏览器上下文跨场景复用：跨报告缓存行为必须发生在同一会话内
  fixture.context = await browser.newContext();
});

test.afterAll(async () => {
  await fixture.context?.close();
  if (!fixture.userId) return;
  await db.query(`DELETE FROM "user" WHERE id = $1`, [fixture.userId]);
});

function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

async function openReport(
  page: Page,
  token: string,
  title: string,
): Promise<FrameLocator> {
  await page.goto(`/s/${token}`);
  await expect(page.locator(`iframe[title="${title}"]`)).toBeVisible();
  return page.frameLocator(`iframe[title="${title}"]`);
}

async function waitCharts(report: FrameLocator, min: number) {
  await expect
    .poll(() => report.locator("canvas").count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(min);
}

type ScriptTiming = {
  file: string;
  transfer: number;
  encoded: number;
  decoded: number;
  start: number;
  dur: number;
};

type ScenarioMetrics = {
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  dcl: number | null;
  load: number | null;
  jsTransfer: number;
  echartsTransfer: number | null;
  dataJsTransfer: number | null;
  mol3dTransfer: number | null;
  longTaskCount: number;
  longTaskTotal: number;
  scripts: ScriptTiming[];
};

// 在 sandbox iframe 内读取 Performance 数据（TAO 已放行，跨源可见）
async function collectMetrics(
  report: FrameLocator,
): Promise<ScenarioMetrics> {
  return report.locator("body").evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const fcpEntry = performance
      .getEntriesByType("paint")
      .find((p) => p.name === "first-contentful-paint");
    const resources = performance.getEntriesByType("resource");
    const scripts = resources
      .filter((r) => r.name.endsWith(".js") || r.name.includes("echarts"))
      .map((r) => {
        const t = r as PerformanceResourceTiming;
        return {
          file: t.name.split("/").pop()!.slice(0, 48),
          transfer: t.transferSize,
          encoded: t.encodedBodySize,
          decoded: t.decodedBodySize,
          start: Math.round(t.startTime),
          dur: Math.round(t.duration),
        };
      });
    const pick = (pattern: RegExp) => {
      const hit = resources.find((r) => pattern.test(r.name)) as
        | PerformanceResourceTiming
        | undefined;
      return hit ? hit.transferSize : null;
    };
    return {
      ttfb: Math.round(nav ? nav.responseStart - nav.requestStart : NaN),
      fcp: fcpEntry ? Math.round(fcpEntry.startTime) : null,
      lcp: null,
      dcl: Math.round(nav ? nav.domContentLoadedEventEnd : NaN),
      load: nav && nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
      jsTransfer: resources.reduce((s, r) => {
        const t = r as PerformanceResourceTiming;
        return s + (t.name.endsWith(".js") || t.name.includes("echarts") ? t.transferSize : 0);
      }, 0),
      echartsTransfer: pick(/echarts/),
      dataJsTransfer: pick(/data\.js/),
      mol3dTransfer: pick(/3Dmol/),
      longTaskCount: 0,
      longTaskTotal: 0,
      scripts,
    };
  });
}

// LCP + long task（buffered observer 回放，图表渲染后读取近似终值）
async function collectLcpLongTasks(
  report: FrameLocator,
): Promise<{ lcp: number | null; longTasks: Array<{ start: number; dur: number }> }> {
  return report.locator("body").evaluate(
    () =>
      new Promise<{
        lcp: number | null;
        longTasks: Array<{ start: number; dur: number }>;
      }>((resolve) => {
        let lcp: number | null = null;
        const longTasks: Array<{ start: number; dur: number }> = [];
        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) {
              lcp = Math.round(entries[entries.length - 1]!.startTime);
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {
          // 浏览器不支持 LCP 时保持 null
        }
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              longTasks.push({
                start: Math.round(e.startTime),
                dur: Math.round(e.duration),
              });
            }
          }).observe({ type: "longtask", buffered: true });
        } catch {
          // 同上
        }
        setTimeout(() => resolve({ lcp, longTasks }), 300);
      }),
  );
}

const results: Record<string, unknown> = {};

test("场景 A-E：报告运行时性能测量", async () => {
  const page = await fixture.context!.newPage();
  const urls = trackRequests(page);

  // ── 场景 A：冷缓存第一次打开 report-02 ──
  const reportA = await openReport(page, fixture.reportA.token, fixture.reportA.title);
  await waitCharts(reportA, 4);
  await page.waitForLoadState("load");
  await page.waitForTimeout(2_000);
  const metricsA = await collectMetrics(reportA);
  const extraA = await collectLcpLongTasks(reportA);
  metricsA.lcp = extraA.lcp;
  metricsA.longTaskCount = extraA.longTasks.length;
  metricsA.longTaskTotal = extraA.longTasks.reduce((s, t) => s + t.dur, 0);

  // ── 场景 D：图表就绪后不滚动，3Dmol 请求计数 ──
  const molWithoutScroll = urls.filter((u) => /3Dmol-min\.js/.test(u)).length;

  // ── 场景 E：滚动到 3D 区域，3Dmol 加载并初始化 ──
  // 懒加载语义：未滚动时 0 请求，滚动后恰好 +1 且只加载一次
  const hasGrid = (await reportA.locator(".v3dgrid").count()) > 0;
  let molAfterScroll = molWithoutScroll;
  if (hasGrid) {
    await reportA.locator(".v3dgrid").evaluate((el) => {
      el.scrollIntoView({ block: "center" });
    });
    await expect
      .poll(() => urls.filter((u) => /3Dmol-min\.js/.test(u)).length, {
        timeout: 15_000,
      })
      .toBe(molWithoutScroll + 1);
    await expect
      .poll(
        () =>
          reportA.locator(".v3dgrid").evaluate((el) => {
            const node = el as HTMLElement;
            return (
              node.querySelectorAll("canvas").length +
              node.querySelectorAll(".v3d-fallback").length
            );
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(1);
    molAfterScroll = urls.filter((u) => /3Dmol-min\.js/.test(u)).length;
  }
  await page.close();

  results.A = { ...metricsA, mol3dRequests: molWithoutScroll };
  results.D = { mol3dRequestsWithoutScroll: molWithoutScroll };
  results.E = { mol3dRequestsAfterScroll: molAfterScroll };

  // ── 场景 B：同会话打开第二份 ECharts 报告 ──
  const pageB = await fixture.context!.newPage();
  trackRequests(pageB);
  const reportB = await openReport(pageB, fixture.reportB.token, fixture.reportB.title);
  await waitCharts(reportB, 3);
  await pageB.waitForLoadState("load");
  await pageB.waitForTimeout(1_500);
  const metricsB = await collectMetrics(reportB);
  const extraB = await collectLcpLongTasks(reportB);
  metricsB.lcp = extraB.lcp;
  metricsB.longTaskCount = extraB.longTasks.length;
  metricsB.longTaskTotal = extraB.longTasks.reduce((s, t) => s + t.dur, 0);
  await pageB.close();
  results.B = metricsB;

  // ── 场景 C：返回 report-02（同会话第三页）──
  const pageC = await fixture.context!.newPage();
  const reportC = await openReport(pageC, fixture.reportA.token, fixture.reportA.title);
  await waitCharts(reportC, 4);
  await pageC.waitForLoadState("load");
  await pageC.waitForTimeout(1_500);
  const metricsC = await collectMetrics(reportC);
  const extraC = await collectLcpLongTasks(reportC);
  metricsC.lcp = extraC.lcp;
  metricsC.longTaskCount = extraC.longTasks.length;
  metricsC.longTaskTotal = extraC.longTasks.reduce((s, t) => s + t.dur, 0);
  await pageC.close();
  results.C = metricsC;

  // 汇总输出（当前架构实测；与改造前形态的对比见迁移文档中的历史记录）
  console.log("\n===== PERF RESULT =====");
  console.log(JSON.stringify(results, null, 2));
});
