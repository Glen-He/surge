import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const fixture = {
  userId: "",
  email: `login-${randomUUID()}@example.test`,
  password: "Strong-login-password-2026!",
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
});

test.afterAll(async () => {
  if (fixture.userId) {
    await db.query(`DELETE FROM "user" WHERE id = $1`, [fixture.userId]);
  }
});

test("单次密码登录立即建立会话，重新验证不会额外创建会话", async ({ page }) => {
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
  await page.getByLabel("邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();

  await expect(page).toHaveURL(/\/home$/);
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
});
