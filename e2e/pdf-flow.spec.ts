import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportDir } from "@/lib/report-storage";

const fixture = {
  userId: "",
  reportId: randomUUID(),
  slug: `e2e_${randomUUID().slice(0, 8)}`,
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
  const dir = reportDir(user.id, fixture.slug);
  await fs.mkdir(dir, { recursive: true });
  const html = `<!doctype html><html><head><title>PDF E2E</title></head><body>
    <button id="preview">preview pdf</button>
    <a id="download" href="./paper.pdf" download>download pdf</a>
    <iframe id="viewer" title="PDF 预览" src="about:blank"></iframe>
    <script>document.getElementById("preview").onclick=function(){document.getElementById("viewer").src="./paper.pdf"}</script>
  </body></html>`;
  await fs.writeFile(path.join(dir, "report.html"), html);
  await fs.writeFile(path.join(dir, "paper.pdf"), "%PDF-1.4\n%%EOF\n");
  const sizeBytes = Buffer.byteLength(html) + Buffer.byteLength("%PDF-1.4\n%%EOF\n");
  await db.query(
    `INSERT INTO reports
       (id, user_id, slug, revision_id, title, date, tag, description, keywords, size_bytes)
     VALUES ($1, $2, $3, $4, $5, '2026-08-27', '', '', '', $6)`,
    [fixture.reportId, user.id, fixture.slug, randomUUID(), fixture.title, sizeBytes],
  );
  await db.query(
    `INSERT INTO report_shares (id, report_id, token) VALUES ($1, $2, $3)`,
    [randomUUID(), fixture.reportId, fixture.token],
  );
});

test.afterAll(async () => {
  if (!fixture.userId) return;
  await fs.rm(reportDir(fixture.userId, fixture.slug), { recursive: true, force: true });
  await db.query(`DELETE FROM "user" WHERE id = $1`, [fixture.userId]);
});

test("sandbox 报告可预览并下载 PDF", async ({ page }) => {
  await page.goto(`/s/${fixture.token}`);
  await expect(page.getByRole("heading", { name: fixture.title })).toBeVisible();
  const report = page.frameLocator(`iframe[title="${fixture.title}"]`);

  await report.locator("#preview").click();
  const preview = page.locator("iframe.report-pdf-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/r\/[^/]+\/paper\.pdf$/);

  await page.getByRole("button", { name: "关闭" }).click();
  const downloadPromise = page.waitForEvent("download");
  await report.locator("#download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("paper.pdf");
});
