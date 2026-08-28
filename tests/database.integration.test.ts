import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";

const enabled = process.env.SURGE_DB_INTEGRATION === "1";

describe.skipIf(!enabled)("PostgreSQL security invariants", () => {
  let userId = "";
  let database: typeof import("@/lib/db").db;
  let context: Awaited<typeof import("@/lib/auth").auth.$context>;
  let createdApiToken = "";

  beforeAll(async () => {
    if (!process.env.REPORTS_DATA_DIR) {
      throw new Error("DB integration tests require an isolated REPORTS_DATA_DIR");
    }
    const [{ auth }, { db }, { ensureSchemaVersioned }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/db"),
      import("@/lib/migrations"),
    ]);
    database = db;
    context = await auth.$context;
    await context.runMigrations();
    await ensureSchemaVersioned();
    const user = await context.internalAdapter.createUser({
      name: "Integration Test",
      email: `integration-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    if (userId) {
      const { userReportsDir } = await import("@/lib/report-storage");
      await fs.rm(userReportsDir(userId), { recursive: true, force: true });
    }
    if (userId) await database.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    await database.query(
      `DELETE FROM security_rate_limits WHERE key LIKE 'api-token-auth:%'`,
    );
  });

  it("迁移后关键安全列和约束存在", async () => {
    const { rows } = await database.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           ('reports', 'revision_id'),
           ('otp_codes', 'code_hash'),
           ('otp_codes', 'code'),
           ('api_tokens', 'token_lookup'),
           ('api_tokens', 'token_prefix'),
           ('api_tokens', 'token_enc'),
           ('reports', 'size_bytes')
         )`,
    );
    const columns = new Map(
      rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable]),
    );
    expect(columns.get("reports.revision_id")).toBe("NO");
    expect(columns.get("otp_codes.code_hash")).toBe("NO");
    expect(columns.has("otp_codes.code")).toBe(false);
    expect(columns.has("api_tokens.token_lookup")).toBe(true);
    expect(columns.has("api_tokens.token_prefix")).toBe(true);
    expect(columns.has("api_tokens.token_enc")).toBe(false);
    expect(columns.get("reports.size_bytes")).toBe("NO");
  });

  it("并发核销同一 OTP 时只有一次成功", async () => {
    const { generateAndStoreOtp, verifyStoredOtp } = await import("@/lib/account");
    const email = `otp-${crypto.randomUUID()}@example.test`;
    const purpose = "integration";
    const code = await generateAndStoreOtp({ email, purpose });
    const results = await Promise.all([
      verifyStoredOtp({ email, purpose, code }),
      verifyStoredOtp({ email, purpose, code }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("并发核销同一账号变更 token 时只有一次成功", async () => {
    const { consumeChangeToken, createChangeToken } = await import("@/lib/account");
    const token = await createChangeToken({
      userId,
      type: "password_change",
    });
    const results = await Promise.all([
      consumeChangeToken(token, userId),
      consumeChangeToken(token, userId),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("并发创建 API token 不会突破每账号一个的约束", async () => {
    const { createApiToken } = await import("@/lib/api-tokens");
    const email = `api-${crypto.randomUUID()}@example.test`;
    await database.query(`UPDATE "user" SET email = $1 WHERE id = $2`, [email, userId]);
    const results = await Promise.all([
      createApiToken(userId, email, "first"),
      createApiToken(userId, email, "second"),
    ]);
    const successes = results.filter((result) => "token" in result);
    expect(successes).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toHaveLength(1);
    if ("token" in successes[0]) createdApiToken = successes[0].token.token!;
  });

  it("同 IP 的大量有效 API token 请求不会被失败限流误伤", async () => {
    const { authenticateApiToken } = await import("@/lib/api-tokens");
    expect(createdApiToken).toMatch(/^sgk_/);
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        authenticateApiToken(`Bearer ${createdApiToken}`, "203.0.113.10"),
      ),
    );
    expect(results.every((result) => result?.id === userId)).toBe(true);
  });

  it("数据库拒绝非 ISO 日期", async () => {
    await expect(
      database.query(
        `INSERT INTO reports
           (id, user_id, slug, revision_id, title, date, tag, description, keywords)
         VALUES ($1, $2, $3, $4, 'invalid-date', 'not-a-date', '', '', '')`,
        [crypto.randomUUID(), userId, `bad-date-${crypto.randomUUID()}`, crypto.randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("通用限流在数据库中跨调用共享", async () => {
    const { consumeSharedRateLimit } = await import("@/lib/db-rate-limit");
    const subject = crypto.randomUUID();
    expect((await consumeSharedRateLimit("integration", subject, 2, 60)).allowed).toBe(true);
    expect((await consumeSharedRateLimit("integration", subject, 2, 60)).allowed).toBe(true);
    expect((await consumeSharedRateLimit("integration", subject, 2, 60)).allowed).toBe(false);
  });

  it("启动回收能区分未提交和已提交的跨存储删除", async () => {
    const {
      moveReportDirToTrash,
      purgeTrash,
      reportDir,
    } = await import("@/lib/report-storage");
    const slug = `recovery-${crypto.randomUUID()}`;
    const dir = reportDir(userId, slug);
    await database.query(
      `INSERT INTO reports
         (id, user_id, slug, revision_id, title, date, tag, description, keywords)
       VALUES ($1, $2, $3, $4, 'recovery', '2026-08-25', '', '', '')`,
      [crypto.randomUUID(), userId, slug, crypto.randomUUID()],
    );
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/report.html`, "ok");

    // Crash before DB delete: the row remains, so startup restores the payload.
    await moveReportDirToTrash(userId, slug);
    await purgeTrash();
    await expect(fs.readFile(`${dir}/report.html`, "utf8")).resolves.toBe("ok");

    // Crash after DB delete: the row is gone, so startup finishes cleanup.
    const committed = await moveReportDirToTrash(userId, slug);
    await database.query(`DELETE FROM reports WHERE user_id = $1 AND slug = $2`, [
      userId,
      slug,
    ]);
    await purgeTrash();
    await expect(fs.access(committed.trashed!)).rejects.toThrow();
    await expect(fs.access(committed.manifest!)).rejects.toThrow();
  });
});
