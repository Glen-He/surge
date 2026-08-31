import { expect, test } from "@playwright/test";
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

const fixture = {
  userId: "",
  reportId: randomUUID(),
  slug: `e2e_${randomUUID().slice(0, 8)}`,
  storageKey: `a_${randomUUID().replaceAll("-", "")}`,
  token: `E2E${randomUUID().replace(/-/g, "")}`,
  title: "PDF 浏览器回归测试",
};

test.beforeAll(async () => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({
    name: "E2E PDF",
    email: `e2e-${randomUUID()}@example.test`,
    emailVerified: true,
  });
  fixture.userId = user.id;
  const dir = reportArtifactDir(user.id, fixture.storageKey);
  await fs.mkdir(dir, { recursive: true });
  const appOrigin = process.env.BETTER_AUTH_URL!;
  const html = `<!doctype html><html><head><title>PDF E2E</title></head><body>
    <button id="preview">preview pdf</button>
    <button id="modal">native modal</button>
    <a id="download" href="./paper.pdf" download>download pdf</a>
    <a id="external" href="${appOrigin}/login" target="_blank">external link</a>
    <iframe id="viewer" title="PDF 预览" src="about:blank"></iframe>
    <output id="local-data">pending</output>
    <output id="worker-data">pending</output>
    <output id="media-type">pending</output>
    <div style="height:1800px">scroll fixture</div>
    <script>
      document.getElementById("preview").onclick=function(){document.getElementById("viewer").src="./paper.pdf"};
      document.getElementById("modal").onclick=function(){alert("report modal")};
      fetch("./data.json").then(function(r){return r.json()}).then(function(v){document.getElementById("local-data").textContent=v.ok});
      fetch("./clip.mp4").then(function(r){document.getElementById("media-type").textContent=r.headers.get("content-type")});
      var workerUrl=URL.createObjectURL(new Blob(["postMessage(42)"],{type:"text/javascript"}));
      var worker=new Worker(workerUrl);worker.onmessage=function(e){document.getElementById("worker-data").textContent=e.data;URL.revokeObjectURL(workerUrl);worker.terminate()};
    </script>
  </body></html>`;
  await fs.writeFile(path.join(dir, "report.html"), html);
  await fs.writeFile(path.join(dir, "data.json"), JSON.stringify({ ok: "loaded" }));
  await fs.writeFile(path.join(dir, "clip.mp4"), "video-data");
  await fs.writeFile(path.join(dir, "paper.pdf"), "%PDF-1.4\n%%EOF\n");
  const sizeBytes =
    Buffer.byteLength(html) +
    Buffer.byteLength('{"ok":"loaded"}') +
    Buffer.byteLength("video-data") +
    Buffer.byteLength("%PDF-1.4\n%%EOF\n");
  await db.query(
    `INSERT INTO reports
       (id, user_id, slug, revision_id, title, date, tag, description, keywords,
        size_bytes, storage_key)
     VALUES ($1, $2, $3, $4, $5, '2026-08-27', '', '', '', $6, $7)`,
    [
      fixture.reportId,
      user.id,
      fixture.slug,
      randomUUID(),
      fixture.title,
      sizeBytes,
      fixture.storageKey,
    ],
  );
  await db.query(
    `INSERT INTO report_shares (id, report_id, token_hash, token_enc)
     VALUES ($1, $2, $3, $4)`,
    [
      randomUUID(),
      fixture.reportId,
      shareTokenHash(fixture.token),
      encryptShareToken(fixture.token),
    ],
  );
});

test.afterAll(async () => {
  if (!fixture.userId) return;
  await fs.rm(reportArtifactDir(fixture.userId, fixture.storageKey), {
    recursive: true,
    force: true,
  });
  await db.query(`DELETE FROM "user" WHERE id = $1`, [fixture.userId]);
});

test("独立内容域报告保留视口、PDF 与外链能力", async ({ page }) => {
  await page.goto(`/s/${fixture.token}`);
  const frame = page.locator(`iframe[title="${fixture.title}"]`);
  const report = page.frameLocator(`iframe[title="${fixture.title}"]`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /^http:\/\/localhost:\d+\/r\//);
  const reportSrc = await frame.getAttribute("src");
  const reportResponse = await page.request.get(reportSrc!);
  expect(reportResponse.headers()["x-frame-options"]).toBeUndefined();
  expect(reportResponse.headers()["content-security-policy"]).toContain(
    `frame-ancestors ${process.env.BETTER_AUTH_URL}`,
  );
  const mainOriginCopy = new URL(reportSrc!);
  mainOriginCopy.host = new URL(process.env.BETTER_AUTH_URL!).host;
  expect((await page.request.get(mainOriginCopy.href)).status()).toBe(404);
  const frameBox = await frame.boundingBox();
  expect(frameBox?.height).toBeGreaterThan(300);
  expect(frameBox?.height).toBeLessThanOrEqual(720);
  expect(await report.locator("body").evaluate(() => window.innerHeight)).toBe(
    Math.round(frameBox!.height),
  );
  const reportHeader = report.locator("[data-surge-report-header]");
  await expect
    .poll(() =>
      reportHeader.evaluate(
        (element) => element.shadowRoot?.querySelector("h1")?.textContent ?? "",
      ),
    )
    .toBe(fixture.title);
  const initialHeaderBox = await reportHeader.boundingBox();
  await report.locator("body").evaluate(() => window.scrollTo(0, 140));
  const scrolledHeaderBox = await reportHeader.boundingBox();
  expect((initialHeaderBox?.y ?? 0) - (scrolledHeaderBox?.y ?? 0)).toBeGreaterThan(120);
  await expect(report.locator("#local-data")).toHaveText("loaded");
  await expect(report.locator("#worker-data")).toHaveText("42");
  await expect(report.locator("#media-type")).toHaveText("video/mp4");
  expect(
    await report.locator("body").evaluate(() => {
      try {
        localStorage.setItem("surge", "blocked");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);

  const dialogPromise = page.waitForEvent("dialog");
  await Promise.all([
    dialogPromise.then(async (dialog) => {
      expect(dialog.message()).toBe("report modal");
      await dialog.accept();
    }),
    report.locator("#modal").click(),
  ]);

  await page.route(/\/paper\.pdf$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await report.locator("#preview").click();
  const preview = page.locator("iframe.report-pdf-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/r\/[^/]+\/paper\.pdf$/);
  await expect(page.getByRole("status")).toContainText("正在加载 PDF");
  await expect(page.getByRole("status")).toBeHidden({ timeout: 7_000 });

  await page.getByRole("button", { name: "关闭" }).click();
  const downloadPromise = page.waitForEvent("download");
  await report.locator("#download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("paper.pdf");

  const popupPromise = page.waitForEvent("popup");
  await report.locator("#external").click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(new URL(popup.url()).pathname).toBe("/login");
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();

  const reportsOrigin = process.env.REPORTS_ORIGIN!;
  const blocked = await page.request.get(`${reportsOrigin}/api/health`);
  expect(blocked.status()).toBe(404);
});
