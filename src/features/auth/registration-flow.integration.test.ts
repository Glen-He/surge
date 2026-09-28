import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "./auth";
import { registerAccount } from "./register-account";
import { endSession } from "@/features/session/end-session";
import { db } from "@/infrastructure/database/client";
import { withSchemaInitializationLock } from "@/infrastructure/database/schema-initialization";
import { ensureBetterAuthSchemaCompatible } from "@/infrastructure/auth/better-auth-migration";
import { ensureSchemaVersioned } from "@/infrastructure/database/migrations";
import { serverEnv } from "@/infrastructure/environment/server";

describe.skipIf(process.env.SURGE_DB_INTEGRATION !== "1")("真实注册与退出认证链路", () => {
  const email = `register-proof-${crypto.randomUUID()}@example.test`;
  let userId = "";
  let policy: { registration_enabled: boolean; invite_required: boolean };
  beforeAll(async () => {
    const context = await auth.$context;
    await withSchemaInitializationLock(async () => {
      await ensureBetterAuthSchemaCompatible();
      await context.runMigrations();
      await ensureSchemaVersioned();
    });
    policy = (await db.query("SELECT registration_enabled, invite_required FROM registration_settings WHERE id = TRUE")).rows[0];
    await db.query("UPDATE registration_settings SET registration_enabled = TRUE, invite_required = FALSE WHERE id = TRUE");
  });
  afterAll(async () => {
    await db.query('DELETE FROM "user" WHERE lower(email) = lower($1)', [email]);
    if (policy) await db.query("UPDATE registration_settings SET registration_enabled = $1, invite_required = $2 WHERE id = TRUE", [policy.registration_enabled, policy.invite_required]);
  });
  it("一次注册完成验证码核销、会话绑定的初始密码设置和正式退出", async () => {
    const origin = serverEnv.BETTER_AUTH_URL ?? "http://localhost:3000";
    const headers = new Headers({ origin, "x-forwarded-for": "198.51.100.77" });
    // 服务器直接生成测试验证码，不发送邮件，也不开放原生公开发码入口。
    const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
    const registered = await registerAccount({ email, otp, password: "Registration-test-2026!", inviteCode: "", clientIp: "198.51.100.77", requestUrl: `${origin}/api/auth/register`, headers });
    headers.set("cookie", registered.setCookies.map((value) => value.split(";")[0]).join("; "));
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe(email);
    userId = session!.user.id;
    await expect(auth.api.verifyPassword({ headers, body: { password: "Registration-test-2026!" } })).resolves.toBeDefined();
    expect((await db.query('SELECT count(*) FROM "session" WHERE "userId" = $1', [userId])).rows[0].count).toBe("1");
    await endSession({ requestUrl: `${origin}/api/auth/end-session`, headers });
    expect((await db.query('SELECT count(*) FROM "session" WHERE "userId" = $1', [userId])).rows[0].count).toBe("0");
  });
});
