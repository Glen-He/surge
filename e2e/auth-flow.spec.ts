import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptSharePasscode, decryptShareToken } from "@/lib/share-token-store";
import { reportArtifactDir, userReportsDir } from "@/lib/report-storage";
import { isGuestEmail } from "@/lib/guest-sandbox";

const fixture = {
  userId: "",
  email: `login-${randomUUID()}@example.test`,
  password: "Strong-login-password-2026!",
  reportId: randomUUID(),
  reportSlug: `share_ui_${randomUUID().slice(0, 8)}`,
  storageKey: `a_${randomUUID().replaceAll("-", "")}`,
  reportTitle: "分享弹窗布局测试",
  dragReports: [
    { title: "排序测试 · 今日一", date: "2026-09-01", sortOrder: 0 },
    { title: "排序测试 · 今日二", date: "2026-09-01", sortOrder: 1 },
    { title: "排序测试 · 今日三", date: "2026-09-01", sortOrder: 2 },
    { title: "排序测试 · 昨日一", date: "2026-08-30", sortOrder: 0 },
    { title: "排序测试 · 昨日二", date: "2026-08-30", sortOrder: 1 },
  ].map((report) => ({
    ...report,
    id: randomUUID(),
    slug: `drag_${randomUUID().slice(0, 8)}`,
    storageKey: `a_${randomUUID().replaceAll("-", "")}`,
  })),
};

test.beforeAll(async () => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    {
      name: "E2E Login",
      email: fixture.email,
      emailVerified: true,
    },
    { method: "test" },
  );
  fixture.userId = user.id;
  await db.query(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [user.id]);
  const passwordHash = await context.password.hash(fixture.password);
  await db.query(
    `INSERT INTO account
       (id, issuer, "accountId", "providerId", "userId", password, "updatedAt")
     VALUES ($1, 'local:credential', $2, 'credential', $2, $3, NOW())`,
    [randomUUID(), user.id, passwordHash],
  );
  const reportHtml =
    "<!doctype html><html><body><main style='height:1200px'>report</main></body></html>";
  await db.query(
    `INSERT INTO reports
       (id, user_id, slug, revision_id, title, date, tag, description, keywords,
        sort_order, size_bytes, storage_key)
     VALUES ($1, $2, $3, $4, $5, '2026-08-31', '', '', '', 0, $6, $7)`,
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
  for (const report of fixture.dragReports) {
    await db.query(
      `INSERT INTO reports
         (id, user_id, slug, revision_id, title, date, tag, description, keywords,
          sort_order, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, '', '', '', $7, $8, $9)`,
      [
        report.id,
        user.id,
        report.slug,
        randomUUID(),
        report.title,
        report.date,
        report.sortOrder,
        Buffer.byteLength(reportHtml),
        report.storageKey,
      ],
    );
    const reportDir = reportArtifactDir(user.id, report.storageKey);
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(`${reportDir}/report.html`, reportHtml);
  }
});

test.afterAll(async () => {
  if (fixture.userId) {
    await fs.rm(userReportsDir(fixture.userId), {
      recursive: true,
      force: true,
    });
    await db.query(`DELETE FROM registration_invites WHERE created_by = $1`, [
      fixture.userId,
    ]);
    await db.query(`DELETE FROM "user" WHERE id = $1`, [fixture.userId]);
  }
});

test("登录与注册切换不会改变认证卡片尺寸", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "布局回归只需在 Chromium 执行一次",
  );

  const previous = await db.query<{
    registration_enabled: boolean;
    invite_required: boolean;
    updated_by: string | null;
  }>(
    `SELECT registration_enabled, invite_required, updated_by
     FROM registration_settings
     WHERE id = TRUE`,
  );
  const policy = previous.rows[0];
  if (!policy) throw new Error("registration settings singleton is missing");

  // 注册策略只控制提交权限，不能隐藏注册入口。
  await db.query(
    `UPDATE registration_settings
     SET registration_enabled = FALSE,
         invite_required = FALSE,
         updated_at = NOW()
     WHERE id = TRUE`,
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "注册", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "当前未开放注册", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "当前未开放注册", exact: true }),
  ).toBeDisabled();

  await db.query(
    `UPDATE registration_settings
     SET registration_enabled = TRUE,
         invite_required = FALSE,
         updated_at = NOW()
     WHERE id = TRUE`,
  );

  try {
    const measureLayout = async () => {
      const selectors = [
        ".auth-stage",
        ".auth-title",
        ".auth-subtitle",
        ".auth-tabs",
        "#auth-email",
        "#auth-password",
        ".auth-actions",
        ".auth-submit",
        ".auth-guest",
      ];
      return Object.fromEntries(
        await Promise.all(
          selectors.map(async (selector) => {
            const box = await page.locator(selector).boundingBox();
            expect(box).not.toBeNull();
            return [
              selector,
              {
                x: box!.x,
                y: box!.y,
                width: box!.width,
                height: box!.height,
              },
            ];
          }),
        ),
      );
    };

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.getByTestId("auth-form")).toHaveAttribute(
        "data-hydrated",
        "true",
      );
      await expect(
        page.getByRole("button", { name: "注册", exact: true }),
      ).toBeVisible();
      await expect(page.locator("body")).toBeFocused();

      const loginLayout = await measureLayout();
      const loginSubmit = await page.locator(".auth-submit").boundingBox();
      const loginGuest = await page.locator(".auth-guest").boundingBox();
      const forgotPassword = await page
        .getByRole("link", { name: "忘记密码？" })
        .boundingBox();
      expect(loginLayout[".auth-tabs"]?.height).toBe(38);
      expect(loginLayout["#auth-email"]?.height).toBe(44);
      expect(loginLayout["#auth-password"]?.height).toBe(44);
      expect(loginSubmit).not.toBeNull();
      expect(loginGuest).not.toBeNull();
      expect(loginSubmit?.height).toBe(40);
      expect(loginGuest?.height).toBe(42);
      expect(loginSubmit?.width).toBe(loginGuest?.width);
      expect(loginSubmit!.x).toBeLessThan(loginGuest!.x);
      expect(forgotPassword).not.toBeNull();
      expect(
        loginLayout["#auth-email"]!.y -
          (loginLayout[".auth-tabs"]!.y + loginLayout[".auth-tabs"]!.height),
      ).toBe(32);
      expect(
        forgotPassword!.y -
          (loginLayout["#auth-password"]!.y +
            loginLayout["#auth-password"]!.height),
      ).toBe(24);
      await page.getByRole("button", { name: "注册", exact: true }).click();
      await expect(page.getByRole("heading", { name: "创建账号" })).toBeVisible();
      await page.waitForTimeout(350);
      const registrationLayout = await measureLayout();
      const registrationSubmit = await page.locator(".auth-submit").boundingBox();

      expect(registrationLayout).toEqual(loginLayout);
      expect(registrationSubmit).not.toBeNull();
      expect(registrationSubmit).toEqual(loginSubmit);

      const inviteInput = page.getByLabel("邀请码（选填）", { exact: true });
      const inviteLabel = page.locator('label[for="auth-invite-code"]');
      const inputBeforeFocus = await inviteInput.boundingBox();
      const signupActions = await page.locator(".auth-actions").boundingBox();
      const labelBeforeFocus = await inviteLabel.boundingBox();
      expect(inputBeforeFocus).not.toBeNull();
      expect(signupActions).not.toBeNull();
      expect(inputBeforeFocus?.height).toBe(44);
      expect(
        signupActions!.y - (inputBeforeFocus!.y + inputBeforeFocus!.height),
      ).toBe(34);
      expect(labelBeforeFocus).not.toBeNull();
      expect(labelBeforeFocus!.y).toBeGreaterThan(inputBeforeFocus!.y);

      await inviteInput.click();
      await page.waitForTimeout(220);
      const labelAfterFocus = await inviteLabel.boundingBox();
      expect(labelAfterFocus).not.toBeNull();
      expect(labelAfterFocus!.y).toBeLessThan(inputBeforeFocus!.y);
      await expect(inviteLabel).toHaveCSS("color", "rgb(0, 113, 227)");

      await inviteInput.fill("ABC123");
      await inviteInput.press("Tab");
      await expect(inviteLabel).toHaveCSS("color", "rgb(134, 134, 139)");
      const labelAfterBlur = await inviteLabel.boundingBox();
      expect(labelAfterBlur).not.toBeNull();
      expect(labelAfterBlur!.y).toBeLessThan(inputBeforeFocus!.y);
    }

  } finally {
    await db.query(
      `UPDATE registration_settings
       SET registration_enabled = $1,
           invite_required = $2,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = TRUE`,
      [policy.registration_enabled, policy.invite_required, policy.updated_by],
    );
  }
});

test("注册验证码使用单输入框并阻止重复自动提交", async ({ page }) => {
  const previous = await db.query<{
    registration_enabled: boolean;
    invite_required: boolean;
    updated_by: string | null;
  }>(
    `SELECT registration_enabled, invite_required, updated_by
     FROM registration_settings
     WHERE id = TRUE`,
  );
  const policy = previous.rows[0];
  if (!policy) throw new Error("registration settings singleton is missing");

  await db.query(
    `UPDATE registration_settings
     SET registration_enabled = TRUE,
         invite_required = FALSE,
         updated_at = NOW()
     WHERE id = TRUE`,
  );

  try {
    let verificationRequests = 0;
    await page.route("**/api/auth/register/send-otp", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.route("**/api/auth/register", async (route) => {
      verificationRequests += 1;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试验证码无效" }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("邮箱", { exact: true }).fill("otp-ui@example.test");
    await page.getByLabel("设置密码", { exact: true }).fill("Password1");
    await page
      .getByRole("button", { name: "获取验证码", exact: true })
      .click();

    const otpInput = page.getByLabel("验证码", { exact: true });
    await expect(otpInput).toHaveCount(1);
    await expect(otpInput).toHaveAttribute("maxlength", "6");
    await expect(otpInput).toHaveAttribute("autocomplete", "one-time-code");

    // 模拟 Safari 在一次 AutoFill 中连续派发两个相同 input 事件。
    await otpInput.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "123456");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(input, "123456");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(() => verificationRequests).toBe(1);
  } finally {
    await db.query(
      `UPDATE registration_settings
       SET registration_enabled = $1,
           invite_required = $2,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = TRUE`,
      [policy.registration_enabled, policy.invite_required, policy.updated_by],
    );
  }
});

test("游客登录与退出仍完整创建并销毁临时账号", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    // 两个浏览器项目并行时使用独立客户端地址，避免共享同一个游客限流桶。
    extraHTTPHeaders: {
      "x-forwarded-for":
        testInfo.project.name === "webkit" ? "198.51.100.42" : "198.51.100.41",
    },
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "游客登录" }).click();
  await expect(page).toHaveURL(/\/home$/);
  const guestNotice = page.locator(".top-notice-card");
  await expect(guestNotice).toContainText("游客登录成功");
  await expect(guestNotice).toHaveCSS("min-height", "56px");
  await expect(guestNotice).toHaveCSS("border-radius", "16px");
  await expect(guestNotice).toHaveCSS(
    "background-color",
    "rgba(240, 240, 245, 0.95)",
  );

  const session = await page.request.get("/api/auth/get-session");
  expect(session.status()).toBe(200);
  const sessionBody = (await session.json()) as { user?: { email?: string } };
  expect(isGuestEmail(sessionBody.user?.email ?? "")).toBe(true);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/account/invitations");
  await expect(page).toHaveURL(/\/account$/);
  const inviteAccess = await page.request.get("/api/account/invites");
  expect(inviteAccess.status()).toBe(403);

  const endSessionStatus = await page.evaluate(async () => {
    const response = await fetch("/api/auth/end-session", { method: "POST" });
    return response.status;
  });
  expect(endSessionStatus).toBe(200);
  const after = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session");
    return response.json();
  });
  expect(after).toBeNull();
  await context.close();
});

test("首页卡片可流畅跨间隙和跨日期排序", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await page.getByLabel("邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page
    .locator("form")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page).toHaveURL(/\/home$/);

  async function dayOrder(date: string) {
    return page.locator(`[data-report-card-date="${date}"]`).evaluateAll(
      (elements) => elements.map((element) => element.getAttribute("data-report-dnd-slug")),
    );
  }

  async function dragToPoint(
    sourceSlug: string,
    point: { x: number; y: number },
    expectedOrder: string[],
    approach?: {
      point: { x: number; y: number };
      verify: () => Promise<void>;
    },
    verifyHoverSuppression = false,
  ) {
    const source = page.locator(`[data-report-dnd-slug="${sourceSlug}"]`);
    const cardSurface = source.locator(":scope > div > a").first();
    const restingShadow = await cardSurface.evaluate(
      (element) => getComputedStyle(element).boxShadow,
    );
    const sourceBox = await source.boundingBox();
    expect(sourceBox).not.toBeNull();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2 + 10,
      sourceBox!.y + sourceBox!.height / 2,
      { steps: 2 },
    );
    await expect(
      page.locator(`[data-report-dnd-slug="${sourceSlug}"][data-dnd-dragging]`),
    ).toBeVisible();
    await expect(cardSurface).toHaveCSS("box-shadow", restingShadow);
    if (approach) {
      await page.mouse.move(approach.point.x, approach.point.y, { steps: 10 });
      await approach.verify();
    }
    await page.mouse.move(point.x, point.y, { steps: 14 });
    await page.waitForTimeout(300);
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/reports/reorder",
    );
    await page.evaluate((slug) => {
      const trace: Array<{
        x: number;
        y: number;
        phase: "dragging" | "settled";
      }> = [];
      (window as typeof window & { __reportDropTrace?: typeof trace })
        .__reportDropTrace = trace;
      let stableFrames = 0;
      let previous: { x: number; y: number } | null = null;
      const startedAt = performance.now();
      const sample = () => {
        const selector = `[data-report-dnd-slug="${CSS.escape(slug)}"]`;
        const dragging = document.querySelector<HTMLElement>(
          `${selector}[data-dnd-dragging]`,
        );
        const settled = [...document.querySelectorAll<HTMLElement>(selector)]
          .find((element) => !element.hasAttribute("data-dnd-placeholder"));
        const element = dragging ?? settled;
        if (element) {
          const rect = element.getBoundingClientRect();
          const current = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          trace.push({
            ...current,
            phase: dragging ? "dragging" : "settled",
          });
          stableFrames = previous &&
              Math.hypot(current.x - previous.x, current.y - previous.y) <= 0.25
            ? stableFrames + 1
            : 0;
          previous = current;
        }
        if (
          performance.now() - startedAt < 1_200 &&
          (dragging || stableFrames < 8)
        ) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    }, sourceSlug);
    await page.mouse.up();
    expect((await response).status()).toBe(200);
    await expect(
      page.locator(`[data-report-dnd-slug="${sourceSlug}"][data-dnd-dragging]`),
    ).toHaveCount(0);
    await page.waitForTimeout(100);
    const trace = await page.evaluate(() =>
      (window as typeof window & {
        __reportDropTrace?: Array<{
          x: number;
          y: number;
          phase: "dragging" | "settled";
        }>;
      }).__reportDropTrace ?? []
    );
    expect(trace.length).toBeGreaterThan(4);
    const start = trace[0];
    const end = trace.at(-1)!;
    const displacement = Math.hypot(end.x - start.x, end.y - start.y);
    let pathLength = 0;
    let maxReverseStep = 0;
    if (displacement > 1) {
      const direction = {
        x: (end.x - start.x) / displacement,
        y: (end.y - start.y) / displacement,
      };
      for (let index = 1; index < trace.length; index += 1) {
        const step = {
          x: trace[index].x - trace[index - 1].x,
          y: trace[index].y - trace[index - 1].y,
        };
        pathLength += Math.hypot(step.x, step.y);
        maxReverseStep = Math.max(
          maxReverseStep,
          -(step.x * direction.x + step.y * direction.y),
        );
      }
    }
    const lastDraggingIndex = trace.findLastIndex(
      (sample) => sample.phase === "dragging",
    );
    const firstSettledIndex = trace.findIndex(
      (sample, index) =>
        index > lastDraggingIndex && sample.phase === "settled",
    );
    const finalCorrection =
      lastDraggingIndex >= 0 && firstSettledIndex >= 0
        ? Math.hypot(
            trace[firstSettledIndex].x - trace[lastDraggingIndex].x,
            trace[firstSettledIndex].y - trace[lastDraggingIndex].y,
          )
        : 0;
    expect(maxReverseStep).toBeLessThanOrEqual(2);
    expect(finalCorrection).toBeLessThanOrEqual(2);
    if (displacement > 1) {
      expect(pathLength / displacement).toBeLessThanOrEqual(1.05);
    }
    if (verifyHoverSuppression) {
      const cardGroup = source.locator(":scope > div").first();
      const reportAction = source.getByText("查看报告", { exact: true });
      const editAction = source.locator('a[aria-label^="编辑 "]');
      await expect(source).toHaveAttribute(
        "data-report-hover-suppressed",
        "true",
      );
      await expect(cardGroup).not.toHaveClass(/\bgroup\b/);
      await expect(reportAction).toHaveCSS("opacity", "0");
      await expect(editAction).toHaveCSS("opacity", "0");
      await page.mouse.move(point.x + 2, point.y);
      await expect(source).toHaveAttribute(
        "data-report-hover-suppressed",
        "true",
      );
      await page.mouse.move(point.x + 4, point.y);
      await expect(source).not.toHaveAttribute(
        "data-report-hover-suppressed",
        "true",
      );
      await expect(cardGroup).toHaveClass(/\bgroup\b/);
      await expect(reportAction).toHaveCSS("opacity", "1");
      await expect(editAction).toHaveCSS("opacity", "1");
    }
    expect(
      await page.locator("[data-report-dnd-slug]").evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-report-dnd-slug")),
      ),
    ).toEqual(expectedOrder);
  }

  const today = "2026-09-01";
  const yesterday = "2026-08-30";
  const standalone = fixture.reportSlug;
  const [todayOne, todayTwo, todayThree, yesterdayOne, yesterdayTwo] =
    fixture.dragReports;
  await expect(page.getByText(todayOne.title, { exact: true })).toBeVisible();
  expect(await dayOrder(today)).toEqual([
    todayOne.slug,
    todayTwo.slug,
    todayThree.slug,
  ]);

  // 进入目标不足一半时保留原位，越过约一半后才让目标卡片平滑让位。
  const firstBox = await page
    .locator(`[data-report-dnd-slug="${todayOne.slug}"]`)
    .boundingBox();
  const secondBox = await page
    .locator(`[data-report-dnd-slug="${todayTwo.slug}"]`)
    .boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  await dragToPoint(todayThree.slug, {
    // 模拟用户把卡片拖到第一槽位左侧较远处再松手；归位轨迹只能向右逼近终点，不能越过后回吸。
    x: firstBox!.x - 120,
    y: firstBox!.y + firstBox!.height / 2,
  }, [
    todayThree.slug,
    todayOne.slug,
    todayTwo.slug,
    standalone,
    yesterdayOne.slug,
    yesterdayTwo.slug,
  ], {
    point: {
      x: secondBox!.x + secondBox!.width / 2 + 20,
      y: firstBox!.y + firstBox!.height / 2,
    },
    verify: async () => {
      expect(await dayOrder(today)).toEqual([
        todayOne.slug,
        todayTwo.slug,
        todayThree.slug,
      ]);
    },
  });
  await expect.poll(() => dayOrder(today)).toEqual([
    todayThree.slug,
    todayOne.slug,
    todayTwo.slug,
  ]);

  // 跨日期同样在拖动中心进入目标卡片后让位，并支持放到第一位。
  const targetBox = await page
    .locator(`[data-report-dnd-slug="${todayThree.slug}"]`)
    .boundingBox();
  expect(targetBox).not.toBeNull();
  await dragToPoint(yesterdayTwo.slug, {
    x: targetBox!.x + targetBox!.width / 2 - 20,
    y: targetBox!.y + targetBox!.height / 2,
  }, [
    yesterdayTwo.slug,
    todayThree.slug,
    todayOne.slug,
    todayTwo.slug,
    standalone,
    yesterdayOne.slug,
  ], undefined, true);
  await expect.poll(() => dayOrder(today)).toEqual([
    yesterdayTwo.slug,
    todayThree.slug,
    todayOne.slug,
    todayTwo.slug,
  ]);
  await expect(
    page
      .locator(`[data-report-dnd-slug="${yesterdayTwo.slug}"]`)
      .getByText(today, { exact: true }),
  ).toBeVisible();
  expect(await dayOrder(yesterday)).toEqual([yesterdayOne.slug]);

  // 把新日期的最后一张卡片移走时，日期组和月份会在放下后消失。
  // 该场景必须仍以重排后的真实可见卡片为唯一终点，不能先飞向旧外层坐标再吸附。
  for (const slug of [todayOne.slug, todayThree.slug, todayTwo.slug]) {
    const olderOrder = (await dayOrder(yesterday)) as string[];
    const targetIndex = olderOrder.indexOf(yesterdayOne.slug) + 1;
    olderOrder.splice(targetIndex, 0, slug);
    const olderTarget = await page
      .locator(`[data-report-dnd-slug="${yesterdayOne.slug}"]`)
      .boundingBox();
    expect(olderTarget).not.toBeNull();
    await dragToPoint(slug, {
      x: olderTarget!.x + olderTarget!.width / 2,
      y: olderTarget!.y + olderTarget!.height - 8,
    }, [
      ...((await dayOrder(today)).filter((item) => item !== slug) as string[]),
      standalone,
      ...olderOrder,
    ]);
  }
  expect(await dayOrder(today)).toEqual([yesterdayTwo.slug]);
  const finalOlderTarget = await page
    .locator(`[data-report-dnd-slug="${yesterdayOne.slug}"]`)
    .boundingBox();
  expect(finalOlderTarget).not.toBeNull();
  const finalOlderOrder = (await dayOrder(yesterday)) as string[];
  finalOlderOrder.splice(
    finalOlderOrder.indexOf(yesterdayOne.slug) + 1,
    0,
    yesterdayTwo.slug,
  );
  await dragToPoint(yesterdayTwo.slug, {
    x: finalOlderTarget!.x + finalOlderTarget!.width / 2,
    y: finalOlderTarget!.y + finalOlderTarget!.height - 8,
  }, [
    standalone,
    ...finalOlderOrder,
  ]);
  await expect(page.locator(`[data-report-day="${today}"]`)).toHaveCount(0);
  expect(await dayOrder(yesterday)).toHaveLength(5);

  // 保存失败通知与游客提示使用完全相同的顶部通知外观。
  await page.evaluate(() => {
    sessionStorage.setItem("surge:report-reorder-error", "1");
  });
  await page.reload();
  const saveErrorNotice = page.locator("[data-sonner-toast]");
  await expect(saveErrorNotice).toContainText(
    "排序保存失败，已重新同步项目顺序",
  );
  await expect(saveErrorNotice).toHaveCSS("min-height", "56px");
  await expect(saveErrorNotice).toHaveCSS("border-radius", "16px");
  await expect(saveErrorNotice).toHaveCSS(
    "background-color",
    "rgba(240, 240, 245, 0.95)",
  );
  await expect(saveErrorNotice.locator("[data-close-button]")).toHaveCount(0);

  const signOut = await page.evaluate(async () => {
    const response = await fetch("/api/auth/end-session", { method: "POST" });
    return response.status;
  });
  expect(signOut).toBe(200);
});

test("密码登录、重新验证与分享弹窗交互保持稳定", async ({ page, browser }) => {
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
  // 部分 Better Auth 版本把 set-password 保持为仅服务端并返回 404；
  // 若其注册为 HTTP 路由，我们的内部 proof 门会返回 403。
  expect([403, 404]).toContain(setPasswordBypass.status());
  const signOutBypass = await page.request.post("/api/auth/sign-out", {
    data: {},
  });
  expect(signOutBypass.status()).toBe(403);

  await page.goto("/forgot");
  await expect(page.getByPlaceholder("邮箱")).not.toBeFocused();
  await page.goto("/reset?token=e2e-invalid-token");
  await expect(page.locator('input[autocomplete="new-password"]').first()).not.toBeFocused();

  await page.goto("/");
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-hydrated", "true");
  let loginSubmissions = 0;
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (request.method() === "POST" && requestUrl.pathname === "/") {
      loginSubmissions += 1;
    }
  });
  const loginEmail = page.getByLabel("邮箱");
  await expect(loginEmail).not.toBeFocused();
  await loginEmail.fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();

  await expect(page).toHaveURL(/\/home$/);
  expect(loginSubmissions).toBe(1);
  await expect(page.getByRole("link", { name: "系统管理" })).toHaveCount(0);
  await page.getByRole("link", { name: "用户中心" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("link", { name: "管理员后台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "邀请注册" })).toBeVisible();
  await page.getByRole("button", { name: "新建令牌" }).click();
  const apiToken = page.locator("code").filter({ hasText: /^sgk_/ }).first();
  await expect(apiToken).toBeVisible();
  await expect(
    page.getByText("更换或撤销后旧值立即失效", { exact: true }).first(),
  ).toBeVisible();
  const apiTokenText = await apiToken.textContent();
  await page.reload();
  await page.getByRole("button", { name: "显示令牌" }).click();
  await expect(
    page.locator("code").filter({ hasText: apiTokenText ?? "" }).first(),
  ).toBeVisible();
  const apiTokenCard = page.locator("section.account-card").filter({
    has: page.getByRole("heading", { name: "API 令牌" }),
  });
  const copyTokenButton = apiTokenCard.locator('[data-copy-variant="icon"]');
  await expect(copyTokenButton).toHaveAccessibleName("复制令牌");
  await copyTokenButton.click();
  await expect(copyTokenButton).toHaveAttribute("data-copy-state", "copied");
  await expect(copyTokenButton).toHaveCSS("color", "rgb(52, 199, 89)");
  await expect(copyTokenButton).toHaveAccessibleName("令牌已复制");
  await page.getByRole("button", { name: "生成邀请码" }).click();
  const inviteCode = page.locator("code").filter({ hasText: /^[0-9A-Z]{6}$/ }).first();
  await expect(inviteCode).toBeVisible();
  const inviteCodeText = await inviteCode.textContent();
  await expect(page.getByRole("button", { name: "复制邀请链接" })).toBeVisible();
  await expect(page.getByText("0 人已注册", { exact: true })).toBeVisible();
  await expect(
    page.getByText("更换或撤销后旧值立即失效", { exact: true }).last(),
  ).toBeVisible();
  const invitationCard = page.locator("section.account-card").filter({
    has: page.getByRole("heading", { name: "邀请注册" }),
  });
  const invitationCardBox = await invitationCard.boundingBox();
  const inviteCodeBox = await inviteCode.boundingBox();
  const copyInviteBox = await page
    .getByRole("button", { name: "复制邀请链接" })
    .boundingBox();
  const inviteCountBox = await page
    .getByText("0 人已注册", { exact: true })
    .boundingBox();
  const detailsLinkBox = await page
    .getByRole("link", { name: "查看邀请详情" })
    .boundingBox();
  expect(invitationCardBox).not.toBeNull();
  expect(inviteCodeBox).not.toBeNull();
  expect(copyInviteBox).not.toBeNull();
  expect(inviteCountBox).not.toBeNull();
  expect(detailsLinkBox).not.toBeNull();
  expect(copyInviteBox!.x - (inviteCodeBox!.x + inviteCodeBox!.width)).toBeLessThanOrEqual(6);
  expect(inviteCountBox!.x).toBeGreaterThan(copyInviteBox!.x + copyInviteBox!.width);
  expect(
    Math.abs(
      detailsLinkBox!.x +
        detailsLinkBox!.width -
        (invitationCardBox!.x + invitationCardBox!.width - 30),
    ),
  ).toBeLessThanOrEqual(2);
  const copyInviteButton = invitationCard.locator(
    '[data-copy-variant="icon"]',
  );
  await copyInviteButton.click();
  await expect(copyInviteButton).toHaveAttribute("data-copy-state", "copied");
  await expect(copyInviteButton).toHaveCSS("color", "rgb(52, 199, 89)");
  await expect(copyInviteButton).toHaveAccessibleName("邀请链接已复制");
  await page.getByRole("link", { name: "查看邀请详情" }).click();
  await expect(page).toHaveURL(/\/account\/invitations$/);
  await expect(page.getByRole("heading", { name: "邀请详情" })).toBeVisible();
  await expect(page.getByText("0 人", { exact: true })).toBeVisible();
  await expect(page.getByText("正常使用", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.reload();
  await expect(page.locator("code").filter({ hasText: inviteCodeText ?? "" }).first()).toBeVisible();
  await page.getByRole("link", { name: "管理员后台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const registrationToggle = page.getByRole("switch", {
    name: "允许用户注册",
  });
  await expect(registrationToggle).not.toBeFocused();
  const registrationToggleBox = await registrationToggle.boundingBox();
  expect(registrationToggleBox).toMatchObject({ width: 38, height: 22 });
  if ((await registrationToggle.getAttribute("aria-checked")) !== "true") {
    await registrationToggle.click();
    await expect(registrationToggle).toHaveAttribute("aria-checked", "true");
  }
  await page.waitForTimeout(250);
  const registrationTrack = registrationToggle.locator("span").first();
  const registrationThumb = registrationTrack.locator("span");
  const registrationTrackBox = await registrationTrack.boundingBox();
  const registrationThumbBox = await registrationThumb.boundingBox();
  expect(registrationTrackBox).not.toBeNull();
  expect(registrationThumbBox).not.toBeNull();
  expect(registrationThumbBox!.x).toBe(registrationTrackBox!.x + 18);
  expect(registrationThumbBox!.x + registrationThumbBox!.width).toBe(
    registrationTrackBox!.x + registrationTrackBox!.width - 2,
  );
  const inviteContext = await browser.newContext();
  const invitePage = await inviteContext.newPage();
  await invitePage.goto(
    `${new URL(page.url()).origin}/#invite=${inviteCodeText}`,
  );
  const lockedInvite = invitePage.getByLabel("邀请码（邀请链接已填写）");
  await expect(lockedInvite).toHaveValue(inviteCodeText ?? "");
  await expect(lockedInvite).toHaveAttribute("readonly", "");
  await inviteContext.close();
  await page.goto("/home");
  await page.goto(`/report/${fixture.reportSlug}`);
  const embeddedReport = page.frameLocator(`iframe[title="${fixture.reportTitle}"]`);
  await embeddedReport.locator("body").evaluate(() => {
    window.parent.postMessage(
      {
        __surgeReportHeaderAction: {
          bridgeToken: "forged",
          action: "share",
        },
      },
      "*",
    );
  });
  await expect(page.getByRole("tabpanel", { name: "分享面板" })).toHaveCount(0);
  await embeddedReport.getByRole("button", { name: "分享" }).click();
  await expect(page.getByRole("tabpanel", { name: "分享面板" })).toBeVisible();
  const shareModal = page.locator(".security-modal");
  const shareModalClose = page.getByRole("button", { name: "关闭" });
  await expect(shareModal).toBeFocused();
  await expect(shareModalClose).not.toBeFocused();
  await expect(shareModalClose).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Tab");
  await expect(shareModalClose).toBeFocused();
  await expect(shareModalClose).toHaveCSS("outline-style", "solid");
  await shareModalClose.click();
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
  const copyBoardLink = managedBoard.locator('[data-copy-variant="pill"]');
  await expect(copyBoardLink).toHaveAccessibleName("复制链接");
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
  await copyBoardLink.click();
  await expect(copyBoardLink).toHaveText("已复制");
  await expect(copyBoardLink).toHaveCSS("background-color", "rgb(52, 199, 89)");
  await expect(copyBoardLink).toHaveCSS("color", "rgb(255, 255, 255)");
  expect(await copyBoardLink.boundingBox()).toEqual(copyBox);

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
  const visitorBrowser = page.context().browser();
  expect(visitorBrowser).not.toBeNull();
  const visitorContext = await visitorBrowser!.newContext();
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
