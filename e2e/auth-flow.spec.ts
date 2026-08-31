import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptSharePasscode, decryptShareToken } from "@/lib/share-token-store";
import { reportArtifactDir } from "@/lib/report-storage";

const fixture = {
  userId: "",
  email: `login-${randomUUID()}@example.test`,
  password: "Strong-login-password-2026!",
  reportId: randomUUID(),
  reportSlug: `share_ui_${randomUUID().slice(0, 8)}`,
  storageKey: `a_${randomUUID().replaceAll("-", "")}`,
  reportTitle: "分享弹窗布局测试",
};

test.beforeAll(async () => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({
    name: "E2E Login",
    email: fixture.email,
    emailVerified: true,
  });
  fixture.userId = user.id;
  const passwordHash = await context.password.hash(fixture.password);
  await db.query(
    `INSERT INTO account
       (id, "accountId", "providerId", "userId", password, "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, NOW())`,
    [randomUUID(), user.id, passwordHash],
  );
  const reportHtml =
    "<!doctype html><html><body><main style='height:1200px'>report</main></body></html>";
  await db.query(
    `INSERT INTO reports
       (id, user_id, slug, revision_id, title, date, tag, description, keywords,
        size_bytes, storage_key)
     VALUES ($1, $2, $3, $4, $5, '2026-08-31', '', '', '', $6, $7)`,
    [
      fixture.reportId,
      user.id,
      fixture.reportSlug,
      randomUUID(),
      fixture.reportTitle,
      Buffer.byteLength(reportHtml),
      fixture.storageKey,
    ],
  );
  const dir = reportArtifactDir(user.id, fixture.storageKey);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    `${dir}/report.html`,
    reportHtml,
  );
});

test.afterAll(async () => {
  if (fixture.userId) {
    await fs.rm(reportArtifactDir(fixture.userId, fixture.storageKey), {
      recursive: true,
      force: true,
    });
    await db.query(`DELETE FROM "user" WHERE id = $1`, [fixture.userId]);
  }
});

test("密码登录、重新验证与分享弹窗交互保持稳定", async ({ page }) => {
  const bypassAttempt = await page.request.post("/api/auth/sign-in/email-otp", {
    data: {
      email: `closed-registration-${randomUUID()}@example.test`,
      otp: "000000",
    },
  });
  expect(bypassAttempt.status()).toBe(403);
  const guestBypass = await page.request.post("/api/auth/sign-in/anonymous", {
    data: {},
  });
  expect(guestBypass.status()).toBe(403);
  const passwordBypass = await page.request.post("/api/auth/sign-in/email", {
    data: { email: fixture.email, password: fixture.password },
  });
  expect(passwordBypass.status()).toBe(403);
  const signUpBypass = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "Bypass",
      email: `native-signup-${randomUUID()}@example.test`,
      password: fixture.password,
    },
  });
  expect(signUpBypass.status()).toBe(403);
  const setPasswordBypass = await page.request.post("/api/auth/set-password", {
    data: { newPassword: fixture.password },
  });
  // Some Better Auth builds keep set-password server-only and return 404;
  // if it is registered as an HTTP route, our internal proof gate returns 403.
  expect([403, 404]).toContain(setPasswordBypass.status());
  const signOutBypass = await page.request.post("/api/auth/sign-out", {
    data: {},
  });
  expect(signOutBypass.status()).toBe(403);

  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();

  await expect(page).toHaveURL(/\/home$/);
  await page.goto(`/report/${fixture.reportSlug}`);
  const embeddedReport = page.frameLocator(`iframe[title="${fixture.reportTitle}"]`);
  await embeddedReport.getByRole("button", { name: "分享" }).click();
  await expect(page.getByRole("tabpanel", { name: "分享面板" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await page.goto("/home");

  const before = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "session" WHERE "userId" = $1`,
    [fixture.userId],
  );
  expect(Number(before.rows[0]?.count)).toBe(1);

  for (const [path, body] of [
    ["/api/auth/change-password", { currentPassword: fixture.password, newPassword: fixture.password }],
    ["/api/auth/change-email", { newEmail: `changed-${randomUUID()}@example.test` }],
    ["/api/auth/delete-user", { password: fixture.password }],
  ] as const) {
    const nativeMutation = await page.evaluate(
      async ({ path, body }) => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return response.status;
      },
      { path, body },
    );
    expect(nativeMutation).toBe(403);
  }

  const verification = await page.evaluate(async (password) => {
    const response = await fetch("/api/account/password/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "password", password }),
    });
    return { status: response.status, body: await response.json() };
  }, fixture.password);
  expect(verification.status).toBe(200);
  expect(verification.body).toMatchObject({ success: true });

  const after = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "session" WHERE "userId" = $1`,
    [fixture.userId],
  );
  expect(Number(after.rows[0]?.count)).toBe(1);

  await page.getByRole("button", { name: `分享 ${fixture.reportTitle}` }).click();
  const modal = page.locator(".security-modal");
  await expect(modal).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "分享面板" })).toBeVisible();
  await page.waitForTimeout(250); // 等待弹窗 0.22s 入场动画结束
  const boardSize = await modal.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }));
  const indicator = page.getByTestId("share-tab-indicator");
  const boardIndicatorTransform = await indicator.evaluate(
    (element) => getComputedStyle(element).transform,
  );

  await page.getByLabel("面板名称").fill("带密码的测试面板");
  const boardProtection = page.getByRole("switch", { name: "无需提取码" });
  const [boardNameBox, boardProtectionBox] = await Promise.all([
    page.getByLabel("面板名称").boundingBox(),
    boardProtection.boundingBox(),
  ]);
  expect(boardProtectionBox!.x).toBeGreaterThan(boardNameBox!.x);
  const boardProtectionControl = page.getByTestId("share-passcode-control");
  const protectionBorderBefore = await boardProtectionControl.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await boardProtection.click();
  const protectionBorderAfter = await boardProtectionControl.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  expect(protectionBorderAfter).toBe(protectionBorderBefore);
  expect(protectionBorderAfter).not.toBe("rgb(0, 113, 227)");
  await expect(page.getByTestId("share-passcode-toggle-track")).toHaveCSS(
    "background-color",
    "rgb(52, 199, 89)",
  );
  await page.getByRole("button", { name: "新建面板" }).click();
  await expect(page.getByText(/提取码 [A-Z0-9]{4}/)).toBeVisible();
  const protectedBoard = await db.query<{
    password_hash: string | null;
    password_enc: string | null;
    token_enc: string | null;
  }>(
    `SELECT password_hash, password_enc, token_enc FROM share_boards WHERE user_id = $1 AND title = $2`,
    [fixture.userId, "带密码的测试面板"],
  );
  expect(protectedBoard.rows[0]?.password_hash).toBeTruthy();
  expect(protectedBoard.rows[0]?.password_enc).toBeTruthy();
  const boardPasscode = decryptSharePasscode(protectedBoard.rows[0]!.password_enc!);
  const boardToken = decryptShareToken(protectedBoard.rows[0]!.token_enc!);
  expect(boardPasscode).toMatch(/^[A-Z0-9]{4}$/);
  await expect(page.getByText(`提取码 ${boardPasscode}`)).toBeVisible();
  const boardSizeAfterCreate = await modal.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }));
  expect(boardSizeAfterCreate).toEqual(boardSize);

  await page.getByRole("tab", { name: "分享链接" }).click();
  await expect(page.getByRole("tabpanel", { name: "分享链接" })).toBeVisible();
  await page.waitForTimeout(350);
  const linkIndicatorTransform = await indicator.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(linkIndicatorTransform).not.toBe(boardIndicatorTransform);
  const linkProtection = page.getByRole("switch", { name: "无需提取码" });
  const [expiryBox, linkProtectionBox] = await Promise.all([
    page.getByLabel("有效期").boundingBox(),
    linkProtection.boundingBox(),
  ]);
  expect(linkProtectionBox!.x).toBeGreaterThan(expiryBox!.x);
  await linkProtection.click();
  await expect(page.getByTestId("share-passcode-toggle-track")).toHaveCSS(
    "background-color",
    "rgb(52, 199, 89)",
  );
  await page.getByRole("button", { name: "生成链接" }).click();
  await expect(page.getByText(/提取码 [A-Z0-9]{4}/)).toBeVisible();
  const protectedShare = await db.query<{
    password_enc: string | null;
    token_enc: string | null;
  }>(
    `SELECT password_enc, token_enc FROM report_shares WHERE report_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [fixture.reportId],
  );
  const sharePasscode = decryptSharePasscode(protectedShare.rows[0]!.password_enc!);
  const shareToken = decryptShareToken(protectedShare.rows[0]!.token_enc!);
  expect(sharePasscode).toMatch(/^[A-Z0-9]{4}$/);
  await expect(page.getByText(`提取码 ${sharePasscode}`)).toBeVisible();
  const linkSize = await modal.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }));
  expect(linkSize).toEqual(boardSize);

  await page.getByRole("tab", { name: "分享面板" }).click();
  const boardSizeAgain = await modal.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }));
  expect(boardSizeAgain).toEqual(boardSize);

  await page.goto("/shares");
  const managedBoard = page.locator("article").filter({ hasText: "带密码的测试面板" });
  const copyBoardLink = managedBoard.getByRole("button", { name: "复制链接" });
  const openBoardLink = managedBoard.getByRole("link", { name: "打开面板" });
  const [copyBox, openBox] = await Promise.all([
    copyBoardLink.boundingBox(),
    openBoardLink.boundingBox(),
  ]);
  expect(openBox!.x).toBeGreaterThan(copyBox!.x);
  expect(Math.abs(openBox!.y - copyBox!.y)).toBeLessThan(1);
  expect(openBox!.height).toBe(copyBox!.height);
  expect(openBox!.width).toBe(copyBox!.width);
  expect(openBox!.x - (copyBox!.x + copyBox!.width)).toBeGreaterThanOrEqual(12);

  // 已登录的属主打开自己的受保护分享时直接进入，不计作外部访客。
  await page.goto(`/b/${boardToken}`);
  await expect(page.getByRole("heading", { name: "带密码的测试面板" })).toBeVisible();
  await expect(page.getByPlaceholder("4 位提取码")).toBeHidden();
  await page.goto(`/s/${shareToken}`);
  await expect(
    page
      .frameLocator(`iframe[title="${fixture.reportTitle}"]`)
      .getByRole("heading", { name: fixture.reportTitle }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("4 位提取码")).toBeHidden();

  // 未登录访问者从自带提取码的链接进入时自动解锁，fragment 随即清除。
  const browser = page.context().browser();
  expect(browser).not.toBeNull();
  const visitorContext = await browser!.newContext();
  const visitor = await visitorContext.newPage();
  const origin = new URL(page.url()).origin;
  await visitor.goto(`${origin}/b/${boardToken}#pwd=${boardPasscode}`);
  await expect(visitor.getByRole("heading", { name: "带密码的测试面板" })).toBeVisible();
  await expect(visitor.getByPlaceholder("4 位提取码")).toBeHidden();
  expect(new URL(visitor.url()).hash).toBe("");
  await visitor.goto(`${origin}/s/${shareToken}#pwd=${sharePasscode}`);
  await expect(
    visitor
      .frameLocator(`iframe[title="${fixture.reportTitle}"]`)
      .getByRole("heading", { name: fixture.reportTitle }),
  ).toBeVisible();
  await expect(visitor.getByPlaceholder("4 位提取码")).toBeHidden();
  expect(new URL(visitor.url()).hash).toBe("");
  await visitorContext.close();
});
