import { expect, test, type BrowserContext, type FrameLocator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/features/auth/auth";
import { db } from "@/infrastructure/database/client";
import { issueCapability } from "@/features/reports/report-capability";
import { REPORT_SANDBOX_TOKENS } from "@/features/reports/serving/report-security";
import { reportArtifactDir } from "@/features/reports/storage/report-storage";
import {
  encryptShareToken,
  shareTokenHash,
} from "@/features/sharing/share-credentials";
import { generateShareToken } from "@/features/sharing/report-share";

// ── 平台公共资源运行时回归验证 ──
//
// 覆盖：/platform/ 版本化 URL 的 immutable 缓存、跨报告缓存命中、
// 报告 HTML 直接引用平台 URL（defer + DOMContentLoaded 初始化）、
// 3Dmol IntersectionObserver 懒加载、/platform/ 与 capability 的安全
// 边界、CSP script-src 与 sandbox 语义。
// 报告 A = reports_local/2026-08-28/report-02（图表 + data.js + 3Dmol），
// 报告 B = reports_local/2026-08-17/report-01（图表 + data.js，无 3Dmol），
// 模板 T = tpl-01（仓库内联数据模板）。A/B 按 upload.md 打包口径复制
//（排除 source/ 与杂项文件）。

const ECHARTS_URL_FILE = "echarts.42f8329d989b6f65.min.js";

// 当前 Playwright 版本 Response 无 fromCache()；缓存命中改由
// platformEchartsTiming 的 ResourceTiming（transferSize===0）验证
type TrackedResponse = {
  url: string;
  status: number;
};

const tracked: TrackedResponse[] = [];
const consoleErrors: string[] = [];

type ReportFixture = {
  id: string;
  slug: string;
  storageKey?: string;
  token: string;
  revisionId: string;
  title: string;
};

const fixture = {
  userId: "",
  context: undefined as BrowserContext | undefined,
  reportA: {
    id: randomUUID(),
    slug: `e2e_${randomUUID().slice(0, 8)}`,
    storageKey: `a_${randomUUID().replaceAll("-", "")}`,
    token: generateShareToken(),
    revisionId: randomUUID(),
    title: "P15 两条序列优化阶段性结果",
  } satisfies ReportFixture,
  reportB: {
    id: randomUUID(),
    slug: `e2e_${randomUUID().slice(0, 8)}`,
    storageKey: `a_${randomUUID().replaceAll("-", "")}`,
    token: generateShareToken(),
    revisionId: randomUUID(),
    title: "线性肽 KTTKS 膜内扩散系数分析",
  } satisfies ReportFixture,
  reportT: {
    id: randomUUID(),
    slug: `e2e_${randomUUID().slice(0, 8)}`,
    token: generateShareToken(),
    revisionId: randomUUID(),
    title: "后台服务性能优化与迁移进度",
  } satisfies ReportFixture,
};

// upload.md 打包口径：zip 不含平台公共库与 source/、.DS_Store 等杂项
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

async function insertReport(
  report: ReportFixture,
  templateKey: string | null,
  sizeBytes: number,
): Promise<void> {
  await db.query(
    `INSERT INTO reports
       (id, user_id, slug, revision_id, title, date, tag, description, keywords,
        size_bytes, storage_key, template_key)
     VALUES ($1, $2, $3, $4, $5, '2026-09-02', '', '', '', $6, $7, $8)`,
    [
      report.id,
      fixture.userId,
      report.slug,
      report.revisionId,
      report.title,
      sizeBytes,
      report.storageKey ?? null,
      templateKey,
    ],
  );
  await db.query(
    `INSERT INTO report_shares (id, report_id, token_hash, token_enc)
     VALUES ($1, $2, $3, $4)`,
    [
      randomUUID(),
      report.id,
      shareTokenHash(report.token),
      encryptShareToken(report.token),
    ],
  );
}

test.beforeAll(async ({ browser }) => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    {
      name: "E2E Platform Assets",
      email: `e2e-${randomUUID()}@example.test`,
      emailVerified: true,
    },
    { method: "test" },
  );
  fixture.userId = user.id;

  const checkout = process.cwd();
  const sizeA = await copyReportFiles(
    path.join(checkout, "reports_local", "2026-08-28", "report-02"),
    reportArtifactDir(fixture.userId, fixture.reportA.storageKey!),
  );
  const sizeB = await copyReportFiles(
    path.join(checkout, "reports_local", "2026-08-17", "report-01"),
    reportArtifactDir(fixture.userId, fixture.reportB.storageKey!),
  );
  await insertReport(fixture.reportA, null, sizeA);
  await insertReport(fixture.reportB, null, sizeB);
  await insertReport(fixture.reportT, "tpl-01", 0);

  // 单一浏览器上下文跨测试复用：跨报告缓存命中必须发生在同一会话内
  fixture.context = await browser.newContext();
});

test.afterAll(async () => {
  await fixture.context?.close();
  if (!fixture.userId) return;
  for (const r of [fixture.reportA, fixture.reportB]) {
    await fs
      .rm(reportArtifactDir(fixture.userId, r.storageKey!), {
        recursive: true,
        force: true,
      })
      .catch(() => {});
  }
  await db.query(`DELETE FROM "user" WHERE id = $1`, [fixture.userId]);
});

function track(page: Page) {
  page.on("response", (response) => {
    tracked.push({
      url: response.url(),
      status: response.status(),
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
}

function requestsFor(pattern: RegExp): TrackedResponse[] {
  return tracked.filter((r) => pattern.test(r.url));
}

async function openSharedReport(
  page: Page,
  token: string,
  title: string,
): Promise<{ report: FrameLocator; frameSrc: string }> {
  await page.goto(`/s/${token}`);
  const frame = page.locator(`iframe[title="${title}"]`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /^http:\/\/localhost:\d+\/r\//);
  // sandbox 属性必须与平台常量完全一致（本任务不得改变沙箱语义）
  await expect(frame).toHaveAttribute("sandbox", REPORT_SANDBOX_TOKENS);
  const frameSrc = (await frame.getAttribute("src"))!;
  return { report: page.frameLocator(`iframe[title="${title}"]`), frameSrc };
}

async function waitCharts(report: FrameLocator, min: number) {
  await expect
    .poll(() => report.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(min);
}

// sandbox iframe 内读取 /platform/echarts 的 ResourceTiming（TAO 已放行）：
// transferSize===0 且 decodedBodySize>0 即 memory/disk cache hit
async function platformEchartsTiming(
  report: FrameLocator,
): Promise<Array<Record<string, number>>> {
  return report.locator("body").evaluate(() => {
    return performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/platform/echarts."))
      .map((e) => {
        const r = e as PerformanceResourceTiming;
        return {
          transferSize: r.transferSize,
          encodedBodySize: r.encodedBodySize,
          decodedBodySize: r.decodedBodySize,
        };
      });
  });
}

test("report-02：平台 URL 直接引用、图表渲染、3Dmol 不随首屏加载", async ({
  browserName,
}) => {
  const page = await fixture.context!.newPage();
  track(page);
  const { report, frameSrc } = await openSharedReport(
    page,
    fixture.reportA.token,
    fixture.reportA.title,
  );

  // 入口文档：报告源 HTML 本身直接引用版本化平台 URL（服务端不做任何
  // 资源路径改写）+ CSP 携带 /platform/ 前缀源
  const frameUrl = new URL(frameSrc);
  const cap = frameUrl.pathname.split("/")[2];
  const capBase = `${frameUrl.origin}/r/${cap}`;
  const docResponse = await page.request.get(frameSrc);
  expect(docResponse.status()).toBe(200);
  const docBody = await docResponse.text();
  expect(docBody).toContain(`src="/platform/${ECHARTS_URL_FILE}"`);
  const csp = docResponse.headers()["content-security-policy"];
  expect(csp).toContain(
    `script-src 'unsafe-inline' 'unsafe-eval' ${capBase}/ ${frameUrl.origin}/platform/`,
  );
  expect(csp).toContain(`sandbox ${REPORT_SANDBOX_TOKENS}`);
  expect(csp).toContain(`frame-ancestors ${process.env.BETTER_AUTH_URL}`);
  expect(csp).toContain(`connect-src ${capBase}/`);

  // 平台 ECharts 经版本化 URL 首次下载（非缓存）
  await waitCharts(report, 4);
  const platformResponses = requestsFor(/\/platform\/echarts\./);
  expect(platformResponses.length).toBeGreaterThanOrEqual(1);
  expect(platformResponses[0].status).toBe(200);
  const timingA = await platformEchartsTiming(report);
  expect(timingA).toHaveLength(1);
  // WebKit 对 opaque-origin sandbox iframe 不填充 ResourceTiming 尺寸字段
  // （恒 0）：首次下载语义仅在 chromium 断言，WebKit 由上方网络事件覆盖
  if (browserName === "chromium") {
    expect(timingA[0].transferSize).toBeGreaterThan(0);
  }
  // data.js 走 capability 命名空间（200）
  expect(requestsFor(/\/r\/[^/]+\/data\.js/).length).toBeGreaterThanOrEqual(1);

  // 图表就绪且未滚动：3Dmol 必须保持零请求
  await page.waitForTimeout(1_500);
  expect(requestsFor(/3Dmol-min\.js/)).toHaveLength(0);
  expect(
    await report.locator(".v3dgrid").evaluate((el) => {
      return (el as HTMLElement).querySelectorAll("canvas").length;
    }),
  ).toBe(0);

  // CSP 无新增 violation（图表脚本全部在允许源内执行）
  expect(
    consoleErrors.filter(
      (m) => m.includes("Content Security Policy") || m.includes("Refused to"),
    ),
  ).toEqual([]);

  await page.close();
});

test("第二份 ECharts 报告与模板报告：平台缓存命中", async ({
  browserName,
}) => {
  const page = await fixture.context!.newPage();
  track(page);

  const { report: reportB } = await openSharedReport(
    page,
    fixture.reportB.token,
    fixture.reportB.title,
  );
  await waitCharts(reportB, 3);
  // 第二份报告：平台 ECharts 命中缓存（transferSize===0）且未回退加载
  // capability 内任何副本。注意 response 事件对缓存命中也会触发，
  // 计数不能当命中信号；WebKit 在 sandbox iframe 中 ResourceTiming
  // 尺寸恒 0，传输语义仅在 chromium 断言，WebKit 由图表渲染 +
  // 无 fallback 覆盖
  expect(requestsFor(/\/r\/[^/]+\/echarts\.min\.js/)).toHaveLength(0);
  const timingB = await platformEchartsTiming(reportB);
  expect(timingB).toHaveLength(1);
  expect(timingB[0].transferSize).toBe(0);
  if (browserName === "chromium") {
    expect(timingB[0].decodedBodySize).toBeGreaterThan(0);
  }

  const { report: reportT } = await openSharedReport(
    page,
    fixture.reportT.token,
    fixture.reportT.title,
  );
  await waitCharts(reportT, 1);
  const timingT = await platformEchartsTiming(reportT);
  expect(timingT).toHaveLength(1);
  expect(timingT[0].transferSize).toBe(0);

  await page.close();
});

test("返回 report-02：平台缓存仍命中且 3Dmol 仍未请求", async () => {
  const page = await fixture.context!.newPage();
  track(page);
  const { report } = await openSharedReport(
    page,
    fixture.reportA.token,
    fixture.reportA.title,
  );
  await waitCharts(report, 4);
  const timing = await platformEchartsTiming(report);
  expect(timing).toHaveLength(1);
  expect(timing[0].transferSize).toBe(0);
  // 未回退加载 capability 内任何副本（WebKit ResourceTiming 恒 0，此为兜底信号）
  expect(requestsFor(/\/r\/[^/]+\/echarts\.min\.js/)).toHaveLength(0);
  await page.waitForTimeout(1_000);
  expect(requestsFor(/3Dmol-min\.js/)).toHaveLength(0);
  await page.close();
});

test("滚动到 3D 区域才加载 3Dmol 并完成初始化", async () => {
  const page = await fixture.context!.newPage();
  track(page);
  const { report } = await openSharedReport(
    page,
    fixture.reportA.token,
    fixture.reportA.title,
  );
  await waitCharts(report, 4);
  expect(requestsFor(/3Dmol-min\.js/)).toHaveLength(0);

  await report.locator(".v3dgrid").evaluate((el) => {
    el.scrollIntoView({ block: "center" });
  });
  await expect
    .poll(() => requestsFor(/3Dmol-min\.js/).length, { timeout: 10_000 })
    .toBe(1);

  // 回到顶部等待一段时间：3Dmol 只加载一次
  await report.locator("body").evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  expect(requestsFor(/3Dmol-min\.js/)).toHaveLength(1);

  // 脚本就绪后初始化：有 WebGL → viewer canvas；无 WebGL → 既有 fallback UI
  await expect
    .poll(
      () =>
        report.locator(".v3dgrid").evaluate((el) => {
          const canvases = (el as HTMLElement).querySelectorAll("canvas").length;
          const fallback = (el as HTMLElement).querySelectorAll(".v3d-fallback").length;
          return `${canvases}/${fallback}`;
        }),
      { timeout: 15_000 },
    )
    .toMatch(/^[1-9]\d*\/0$|^0\/[1-9]\d*$/);
  await page.close();
});

test("平台资源与 capability 安全边界", async () => {
  const reportsOrigin = process.env.REPORTS_ORIGIN!;
  const mainOrigin = process.env.BETTER_AUTH_URL!;
  const cap = issueCapability(
    fixture.reportA.id,
    fixture.reportA.revisionId,
    0,
  );

  // 版本化平台 URL 公开可访问 + immutable 长缓存 + 正确 MIME
  const ok = await fixture
    .context!.request.get(`${reportsOrigin}/platform/${ECHARTS_URL_FILE}`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(ok.headers()["x-content-type-options"]).toBe("nosniff");
  expect(ok.headers()["content-type"]).toBe("text/javascript; charset=utf-8");

  // 未知文件 / 未带 hash / 错误 hash / 嵌套段 → 一律 404
  for (const bad of [
    "/platform/echarts.min.js",
    "/platform/unknown.js",
    "/platform/echarts.0000000000000000.min.js",
    `/platform/${ECHARTS_URL_FILE}/extra`,
    "/platform/",
    "/platform/..%2fecharts.min.js",
  ]) {
    expect(
      (await fixture.context!.request.get(`${reportsOrigin}${bad}`)).status(),
    ).toBe(404);
  }
  // 主站 origin 不暴露平台资源（内容域收口不变）
  expect(
    (
      await fixture
        .context!.request.get(`${mainOrigin}/platform/${ECHARTS_URL_FILE}`)
    ).status(),
  ).toBe(404);
  // 主站 origin 拿到 capability 也不输出报告（内容域边界不变）
  expect(
    (
      await fixture.context!.request.get(`${mainOrigin}/r/${cap}/report.html`)
    ).status(),
  ).toBe(404);

  // capability 正常路径与失效路径
  expect(
    (
      await fixture.context!.request.get(
        `${reportsOrigin}/r/${cap}/report.html`,
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await fixture.context!.request.get(
        `${reportsOrigin}/r/badcap/report.html`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (await fixture.context!.request.get(`${reportsOrigin}/r/${cap}/data.js`))
      .status(),
  ).toBe(200);
});
