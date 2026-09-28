import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { auth } from "@/features/auth/auth";
import { db } from "@/infrastructure/database/client";
import { userReportsDir } from "@/features/reports/storage/report-storage";
import { createReportShare, hashSharePassword, revokeReportShare } from "@/features/sharing/report-share";
import { createShareBoard, setBoardMembership, updateShareBoard } from "@/features/sharing/share-board";
import { findPublicShareBoard } from "@/features/sharing/public-share-board";
import { encryptSharePasscode } from "@/features/sharing/share-credentials";

const fixture = {
  userId: "",
  email: `website-${randomUUID()}@example.test`,
  password: "Website-test-password-2026!",
};
const websiteHtml = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}header{background:#eef6ff}main{height:100vh}</style></head><body><header class="rpt-head">网页自有页头</header><main><h1>网页自己的内容</h1><button onclick="document.querySelector('#result').textContent='交互正常'">网页按钮</button><p id="result"></p></main></body></html>`;

test.beforeAll(async () => {
  const context = await auth.$context;
  fixture.userId = (await context.internalAdapter.createUser({ name: "Website test", email: fixture.email, emailVerified: true }, { method: "test" })).id;
  await db.query(`INSERT INTO account (id, issuer, "accountId", "providerId", "userId", password, "updatedAt") VALUES ($1, 'local:credential', $2, 'credential', $2, $3, NOW())`, [randomUUID(), fixture.userId, await context.password.hash(fixture.password)]);
});

test.afterAll(async () => {
  if (fixture.userId) {
    await db.query('DELETE FROM "user" WHERE id = $1', [fixture.userId]);
    await fs.rm(userReportsDir(fixture.userId), { recursive: true, force: true });
  }
});

async function expectBareWebsite(page: Page) {
  const iframe = page.locator("iframe.report-frame");
  await expect(iframe).toBeVisible();
  await expect(page.locator(".rpt-sys-head")).toHaveCount(0);
  await expect(iframe).not.toHaveAttribute("sandbox", /allow-same-origin/);
  const source = await iframe.getAttribute("src");
  expect(source).toMatch(/^http:\/\/localhost:\d+\/report\/[^/]+\/report.html$/);
  const frame = page.frameLocator("iframe.report-frame");
  await expect(frame.getByText("网页自有页头", { exact: true })).toBeVisible();
  await expect(frame.locator("[data-surge-report-header]")).toHaveCount(0);
  await frame.getByRole("button", { name: "网页按钮" }).click();
  await expect(frame.locator("#result")).toHaveText("交互正常");
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(await iframe.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  expect(await page.evaluate(() => window.opener === null)).toBe(true);
  return source!;
}

async function expectBasicFieldsLayout(page: Page) {
  const originalViewport = page.viewportSize()!;
  const card = page.locator(".project-card").first();
  const row = card.locator(".project-basics-row");
  await expect(card.getByLabel("展示模式")).toHaveCount(1);
  for (const width of [1280, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    // 等待视口调整完成布局，再测量错误槽与模式切换是否引发位移。
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await row.scrollIntoViewIfNeeded();
    const date = await row.getByRole("button", { name: "日期", exact: true }).boundingBox();
    const mode = await row.getByRole("combobox").boundingBox();
    const title = await card.getByLabel("项目名称").boundingBox();
    expect(date!.height).toBe(40);
    expect(mode!.height).toBe(date!.height);
    const labels = await row.locator(".project-label").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    if (width === 1280) {
      expect(mode!.x).toBeGreaterThan(date!.x + date!.width);
      expect(mode!.y).toBe(date!.y);
      expect(labels[0]).toBe(labels[1]);
      expect(date!.width).toBeLessThan(title!.width);
    } else if (width === 320) {
      expect(mode!.x).toBe(date!.x);
      expect(mode!.y).toBeGreaterThan(date!.y + date!.height);
    }
    const slots = row.locator(".project-error");
    expect(await slots.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))).toEqual([20, 20]);
    const before = { row: await row.boundingBox(), card: await card.boundingBox() };
    // 日期选择器不会主动产生空值；在常驻槽填入真实错误文案，验证报错布局契约。
    await slots.first().evaluate((node) => { node.textContent = "请选择日期"; });
    expect({ row: await row.boundingBox(), card: await card.boundingBox() }).toEqual(before);
    await slots.first().evaluate((node) => { node.textContent = ""; });
    const originalMode = await row.getByRole("combobox").textContent();
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: originalMode === "网页发布" ? "汇报展示" : "网页发布" }).click();
    expect({ row: await row.boundingBox(), card: await card.boundingBox() }).toEqual(before);
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: originalMode!, exact: true }).click();
    expect({ row: await row.boundingBox(), card: await card.boundingBox() }).toEqual(before);
  }
  await page.setViewportSize(originalViewport);
  await page.evaluate(() => scrollTo(0, 0));
}

test("网页上传、新标签页、密码门和面板权限完整复用", async ({ page, browser }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("邮箱", { exact: true }).fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByTestId("auth-form").getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/new-report");
  await expect(page.getByLabel("展示模式")).toHaveText("汇报展示");
  await expect(page.getByLabel("展示模式")).not.toBeFocused();
  await expectBasicFieldsLayout(page);
  expect(await page.locator(".project-card").evaluateAll((cards) => cards.map((card) => getComputedStyle(card).borderRadius))).toEqual(["22px", "22px", "22px", "22px"]);
  await expect(page.getByLabel("展示模式")).toHaveCSS("border-radius", "12px");
  await expect(page.locator("textarea.project-input")).toHaveCSS("border-radius", "16px");
  await expect(page.locator(".upload-zone")).toHaveCSS("border-radius", "16px");
  await page.screenshot({ path: testInfo.outputPath("new-project.png"), fullPage: true });
  const gridBefore = await page.locator(".project-grid").boundingBox();
  await page.getByLabel("展示模式").click();
  await page.getByRole("option", { name: "网页发布" }).click();
  expect(await page.locator(".project-grid").boundingBox()).toEqual(gridBefore);
  const cardHeights = await page.locator(".project-card").evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
  expect(new Set(cardHeights).size).toBe(1);
  await page.getByLabel("项目名称").fill("网页发布验收");
  await page.locator('input[type="file"]').setInputFiles({ name: "website.html", mimeType: "text/html", buffer: Buffer.from(websiteHtml) });
  const upload = page.waitForResponse((response) => response.url().endsWith("/api/reports") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建项目" }).click();
  const response = await upload;
  expect(response.status()).toBe(200);
  const { slug } = await response.json() as { slug: string };
  await expect(page).toHaveURL(/\/home$/);
  const websiteLink = page.locator(`a[href="/view/${slug}"]`);
  await expect(websiteLink.getByText("网页", { exact: true })).toBeVisible();
  await expect(websiteLink).toHaveAttribute("target", "_blank");
  await expect(websiteLink).toHaveAttribute("rel", "noopener noreferrer");
  const opened = page.waitForEvent("popup");
  await websiteLink.click();
  const website = await opened;
  await expectBareWebsite(website);
  await website.close();
  await expect(page).toHaveURL(/\/home$/);

  // 普通汇报仍默认在当前标签页打开，并注入原有系统头。
  const origin = new URL(page.url()).origin;
  const frameUpload = await page.request.post("/api/reports", {
    headers: { Origin: origin },
    multipart: { title: "汇报模式验收", date: "2026-09-26", file: { name: "report.html", mimeType: "text/html", buffer: Buffer.from(websiteHtml) } },
  });
  expect(frameUpload.status()).toBe(200);
  const frameSlug = (await frameUpload.json()).slug as string;
  await page.reload();
  const frameLink = page.locator(`a[href="/view/${frameSlug}"]`);
  await expect(frameLink).not.toHaveAttribute("target", "_blank");
  await frameLink.click();
  await expect(page).toHaveURL(`/view/${frameSlug}`);
  await expect(page.frameLocator("iframe.report-frame").locator("[data-surge-report-header]")).toBeVisible();
  await page.goto(`/edit/${slug}`);
  await expect(page.getByLabel("展示模式")).toHaveText("网页发布");
  await expectBasicFieldsLayout(page);
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/reports/${slug}`) && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "保存修改" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page).toHaveURL(/\/home$/);

  const share = await createReportShare({ userEmail: "owner@example.test", userId: fixture.userId, slug, passwordProtected: true, requestedPasscode: "A7B2" });
  const board = await createShareBoard(fixture.userId, "网页发布面板", await hashSharePassword("C3D4"), encryptSharePasscode("C3D4"), null, slug);
  expect(share.token).toMatch(/^[a-z0-9]{8}$/);
  expect(board.token).toMatch(/^[a-z0-9]{8}$/);
  await setBoardMembership(fixture.userId, board.id, frameSlug, true);
  const publicBoard = await findPublicShareBoard(board.token!);
  const itemId = publicBoard!.items.find((item) => item.slug === slug)!.id;
  const frameItemId = publicBoard!.items.find((item) => item.slug === frameSlug)!.id;
  expect(itemId).toMatch(/^[a-z0-9]{4}$/);
  expect(frameItemId).toMatch(/^[a-z0-9]{4}$/);
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  try {
    // 两种条目入口均直接拒绝旧标识，不跳转到新短码。
    for (const url of [`${origin}/board/${board.token}/item/${"a".repeat(32)}`, `${origin}/share/${board.token}?item=${"a".repeat(32)}`]) {
      await visitor.goto(url);
      await expect(visitor).toHaveURL(url);
      await expect(visitor.getByText("该汇报已不在分享面板中")).toBeVisible();
      await expect(visitor.locator("iframe")).toHaveCount(0);
    }
    await visitor.goto(`${origin}/share/${share.token}`);
    await expect(visitor.getByPlaceholder("4 位提取码")).toBeVisible();
    await expect(visitor.locator("iframe")).toHaveCount(0);
    await visitor.getByPlaceholder("4 位提取码").fill("ZZZZ");
    await visitor.getByRole("button", { name: "查看报告" }).click();
    await expect(visitor.getByText("提取码不正确", { exact: true })).toBeVisible();
    await visitor.getByPlaceholder("4 位提取码").fill("A7B2");
    await visitor.getByRole("button", { name: "查看报告" }).click();
    const standaloneCap = await expectBareWebsite(visitor);
    await revokeReportShare(fixture.userId, share.id);
    expect((await visitor.request.get(standaloneCap)).status()).toBe(404);
    await visitor.reload();
    await expect(visitor.getByText("链接无效或已失效")).toBeVisible();

    // 直接进入网页落地页也必须先解锁面板，不能绕过密码门。
    const boardWebsiteUrl = `${origin}/share/${board.token}?item=${itemId}`;
    await visitor.goto(boardWebsiteUrl);
    await expect(visitor.getByPlaceholder("4 位提取码")).toBeVisible();
    await expect(visitor.locator("iframe")).toHaveCount(0);
    await visitor.goto(`${origin}/board/${board.token}#pwd=C3D4`);
    const frameBoardLink = visitor.locator(`a[href="/board/${board.token}/item/${frameItemId}"]`);
    await expect(frameBoardLink).not.toHaveAttribute("target", "_blank");
    await frameBoardLink.click();
    await expect(visitor).toHaveURL(`${origin}/board/${board.token}/item/${frameItemId}`);
    await expect(visitor.frameLocator("iframe.report-frame").locator("[data-surge-report-header]")).toBeVisible();
    await visitor.goto(`${origin}/board/${board.token}`);
    const publicLink = visitor.locator(`a[href="/share/${board.token}?item=${itemId}"]`);
    await expect(publicLink.getByText("网页", { exact: true })).toBeVisible();
    await expect(publicLink).toHaveAttribute("target", "_blank");
    await expect(publicLink).toHaveAttribute("rel", "noopener noreferrer");
    const publicOpened = visitor.waitForEvent("popup");
    await publicLink.click();
    const publicWebsite = await publicOpened;
    const boardCap = await expectBareWebsite(publicWebsite);
    await publicWebsite.goto(`${origin}/board/${board.token}/item/${itemId}`);
    await expect(publicWebsite).toHaveURL(boardWebsiteUrl);
    await expectBareWebsite(publicWebsite);
    await updateShareBoard(fixture.userId, board.id, { disabled: true });
    expect((await visitor.request.get(boardCap)).status()).toBe(404);
    await publicWebsite.reload();
    await expect(publicWebsite.getByText("该汇报已不在分享面板中")).toBeVisible();
    await updateShareBoard(fixture.userId, board.id, { disabled: false });
    await publicWebsite.goto(boardWebsiteUrl);
    await expect(publicWebsite.getByPlaceholder("4 位提取码")).toBeVisible();
    await setBoardMembership(fixture.userId, board.id, slug, false);
    await publicWebsite.reload();
    await expect(publicWebsite.getByText("该汇报已不在分享面板中")).toBeVisible();
    await publicWebsite.close();

    await visitor.goto(`${origin}/share/${"a".repeat(22)}`);
    await expect(visitor.getByText("链接无效或已失效")).toBeVisible();
    // 旧路由没有兼容页面或重定向。
    for (const oldPath of [`/s/${share.token}`, `/b/${board.token}`, `/r/invalid/report.html`, `/report/${slug}`, "/shares"]) {
      const oldResponse = await visitor.request.get(`${origin}${oldPath}`, { maxRedirects: 0 });
      expect(oldResponse.status()).toBe(404);
    }
  } finally {
    await visitorContext.close();
  }
});
