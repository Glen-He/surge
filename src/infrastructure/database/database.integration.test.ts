import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";

const enabled = process.env.SURGE_DB_INTEGRATION === "1";

describe.skipIf(!enabled)("PostgreSQL security invariants", () => {
  let userId = "";
  let database: typeof import("@/infrastructure/database/client").db;
  let context: Awaited<typeof import("@/features/auth/auth").auth.$context>;
  let createdApiToken = "";

  beforeAll(async () => {
    if (!process.env.REPORTS_DATA_DIR) {
      throw new Error("DB integration tests require an isolated REPORTS_DATA_DIR");
    }
    const [
      { auth },
      { db },
      { ensureSchemaVersioned },
      { ensureBetterAuthSchemaCompatible },
    ] = await Promise.all([
      import("@/features/auth/auth"),
      import("@/infrastructure/database/client"),
      import("@/infrastructure/database/migrations"),
      import("@/infrastructure/auth/better-auth-migration"),
    ]);
    database = db;
    context = await auth.$context;
    await ensureBetterAuthSchemaCompatible();
    await context.runMigrations();
    await ensureSchemaVersioned();
    const user = await context.internalAdapter.createUser(
      {
        name: "Integration Test",
        email: `integration-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: "test" },
    );
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    if (userId) {
      const { userReportsDir } = await import("@/features/reports/storage/report-storage");
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
           ,('reports', 'storage_key'),
           ('account', 'issuer'),
           ('user', 'role'),
           ('user', 'banned'),
           ('user', 'banReason'),
           ('user', 'banExpires'),
           ('session', 'impersonatedBy'),
           ('reports', 'tag_color'),
           ('reports', 'external_network_enabled'),
           ('report_shares', 'token_hash'),
           ('report_shares', 'token_enc'),
           ('report_shares', 'token'),
           ('report_shares', 'revoked_at'),
           ('report_shares', 'password_hash'),
           ('report_shares', 'password_enc'),
           ('share_boards', 'token_hash'),
           ('share_boards', 'token_enc'),
           ('share_boards', 'token'),
           ('share_boards', 'password_hash'),
           ('share_boards', 'password_enc'),
           ('share_boards', 'access_epoch'),
           ('share_boards', 'expires_at')
           ,('registration_settings', 'registration_enabled')
           ,('registration_settings', 'invite_required')
           ,('registration_invites', 'code_lookup')
           ,('registration_invites', 'code_enc')
           ,('registration_invites', 'label')
           ,('registration_invites', 'max_uses')
           ,('registration_invites', 'expires_at')
           ,('registration_invite_redemptions', 'user_id')
         )`,
    );
    const columns = new Map(
      rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable]),
    );
    expect(columns.get("reports.revision_id")).toBe("NO");
    expect(columns.get("otp_codes.code_hash")).toBe("NO");
    expect(columns.has("otp_codes.code")).toBe(false);
    expect(columns.has("api_tokens.token_lookup")).toBe(true);
    expect(columns.has("api_tokens.token_prefix")).toBe(false);
    expect(columns.get("api_tokens.token_enc")).toBe("NO");
    expect(columns.get("reports.size_bytes")).toBe("NO");
    expect(columns.has("reports.storage_key")).toBe(true);
    expect(columns.get("account.issuer")).toBe("NO");
    expect(columns.has("user.role")).toBe(true);
    expect(columns.has("user.banned")).toBe(true);
    expect(columns.has("user.banReason")).toBe(true);
    expect(columns.has("user.banExpires")).toBe(true);
    expect(columns.has("session.impersonatedBy")).toBe(true);
    expect(columns.get("reports.tag_color")).toBe("NO");
    expect(columns.has("reports.external_network_enabled")).toBe(false);
    expect(columns.get("report_shares.token_hash")).toBe("NO");
    expect(columns.get("report_shares.token_enc")).toBe("NO");
    expect(columns.has("report_shares.token")).toBe(false);
    expect(columns.has("report_shares.revoked_at")).toBe(false);
    expect(columns.has("report_shares.password_hash")).toBe(true);
    expect(columns.has("report_shares.password_enc")).toBe(true);
    expect(columns.get("share_boards.token_hash")).toBe("NO");
    expect(columns.get("share_boards.token_enc")).toBe("NO");
    expect(columns.has("share_boards.token")).toBe(false);
    expect(columns.has("share_boards.password_hash")).toBe(true);
    expect(columns.has("share_boards.password_enc")).toBe(true);
    expect(columns.get("share_boards.access_epoch")).toBe("NO");
    expect(columns.has("share_boards.expires_at")).toBe(true);
    expect(columns.get("registration_settings.registration_enabled")).toBe("NO");
    expect(columns.get("registration_settings.invite_required")).toBe("NO");
    expect(columns.get("registration_invites.code_lookup")).toBe("NO");
    expect(columns.get("registration_invites.code_enc")).toBe("NO");
    expect(columns.has("registration_invites.label")).toBe(false);
    expect(columns.has("registration_invites.max_uses")).toBe(false);
    expect(columns.has("registration_invites.expires_at")).toBe(false);
    expect(columns.get("registration_invite_redemptions.user_id")).toBe("NO");
    const inviteIndexes = await database.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'registration_invites_one_per_creator'`,
    );
    expect(inviteIndexes.rows).toHaveLength(1);
    const reportConstraints = await database.query<{
      conname: string;
      convalidated: boolean;
    }>(
      `SELECT conname, convalidated
       FROM pg_constraint
       WHERE conrelid = 'reports'::regclass
         AND conname IN (
           'reports_exactly_one_content_source',
           'reports_storage_size_positive',
           'reports_tag_color_palette'
         )`,
    );
    expect(
      Object.fromEntries(
        reportConstraints.rows.map((row) => [row.conname, row.convalidated]),
      ),
    ).toEqual({
      reports_exactly_one_content_source: true,
      reports_storage_size_positive: true,
      reports_tag_color_palette: true,
    });
    const shareConstraints = await database.query<{
      conname: string;
      convalidated: boolean;
    }>(
      `SELECT conname, convalidated
       FROM pg_constraint
       WHERE conname IN (
         'report_shares_password_pair',
         'share_boards_password_pair'
       )`,
    );
    expect(
      Object.fromEntries(
        shareConstraints.rows.map((row) => [row.conname, row.convalidated]),
      ),
    ).toEqual({
      report_shares_password_pair: true,
      share_boards_password_pair: true,
    });
    const migrationIntegrity = await database.query<{
      total: string;
      protected: string;
      external_network_removed: boolean;
      registration_admin_added: boolean;
      single_invite_added: boolean;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE checksum ~ '^[0-9a-f]{64}$')::text AS protected,
              bool_or(version = 24) AS external_network_removed,
              bool_or(version = 25) AS registration_admin_added,
              bool_or(version = 26) AS single_invite_added
       FROM schema_migrations`,
    );
    expect(Number(migrationIntegrity.rows[0]?.total)).toBeGreaterThanOrEqual(22);
    expect(migrationIntegrity.rows[0]?.protected).toBe(
      migrationIntegrity.rows[0]?.total,
    );
    expect(migrationIntegrity.rows[0]?.external_network_removed).toBe(true);
    expect(migrationIntegrity.rows[0]?.registration_admin_added).toBe(true);
    expect(migrationIntegrity.rows[0]?.single_invite_added).toBe(true);
  });

  it("同一邀请码可被多个用户使用且每个用户只记录一次", async () => {
    const secondUser = await context.internalAdapter.createUser(
      {
        name: "Invite Concurrency Test",
        email: `invite-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: "test" },
    );
    const {
      createRegistrationInvite,
      redeemRegistrationInvite,
    } = await import("@/features/auth/registration-invites");
    const created = await createRegistrationInvite(userId);
    if ("errorCode" in created) {
      throw new Error("test user unexpectedly already has an invite");
    }
    const inviteCode = created.invite.code;
    if (!inviteCode) {
      throw new Error("test invite could not be decrypted");
    }
    const firstClient = await database.connect();
    const secondClient = await database.connect();
    try {
      const results = await Promise.all([
        redeemRegistrationInvite({
          client: firstClient,
          code: inviteCode,
          userId,
        }),
        redeemRegistrationInvite({
          client: secondClient,
          code: inviteCode.toLowerCase(),
          userId: secondUser.id,
        }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(2);
      const state = await database.query<{ use_count: number; redemptions: string }>(
        `SELECT i.use_count,
                COUNT(r.id)::text AS redemptions
         FROM registration_invites i
         LEFT JOIN registration_invite_redemptions r ON r.invite_id = i.id
         WHERE i.id = $1
         GROUP BY i.id`,
        [created.invite.id],
      );
      expect(state.rows[0]).toEqual({ use_count: 2, redemptions: "2" });
    } finally {
      firstClient.release();
      secondClient.release();
      await database.query(
        `DELETE FROM registration_invite_redemptions WHERE invite_id = $1`,
        [created.invite.id],
      );
      await database.query(`DELETE FROM registration_invites WHERE id = $1`, [
        created.invite.id,
      ]);
      await database.query(`DELETE FROM "user" WHERE id = $1`, [secondUser.id]);
    }
  });

  it("邀请码读取与撤销操作按创建者严格隔离", async () => {
    const otherUser = await context.internalAdapter.createUser(
      {
        name: "Invite Ownership Test",
        email: `invite-owner-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: "test" },
    );
    const {
      createRegistrationInvite,
      getRegistrationInvite,
      revokeRegistrationInvite,
    } = await import("@/features/auth/registration-invites");
    const created = await createRegistrationInvite(userId);
    if ("errorCode" in created) {
      throw new Error("test user unexpectedly already has an invite");
    }

    try {
      await expect(getRegistrationInvite(otherUser.id)).resolves.toBeNull();
      await expect(
        revokeRegistrationInvite(otherUser.id),
      ).resolves.toBe(false);
      await expect(getRegistrationInvite(userId)).resolves.toEqual(
        expect.objectContaining({ id: created.invite.id }),
      );
      await expect(
        revokeRegistrationInvite(userId),
      ).resolves.toBe(true);
    } finally {
      await database.query(`DELETE FROM registration_invites WHERE id = $1`, [
        created.invite.id,
      ]);
      await database.query(`DELETE FROM "user" WHERE id = $1`, [otherUser.id]);
    }
  });

  it("修改密码与撤销其他设备会话作为同一事务完成", async () => {
    const accountId = crypto.randomUUID();
    const currentSessionId = crypto.randomUUID();
    const currentSessionToken = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    await database.query(
      `INSERT INTO account
         (id, issuer, "accountId", "providerId", "userId", password, "updatedAt")
       VALUES ($1, 'local:credential', $2, 'credential', $2, 'old-hash', NOW())`,
      [accountId, userId],
    );
    await database.query(
      `INSERT INTO "session"
         (id, "expiresAt", token, "updatedAt", "userId")
       VALUES ($1, NOW() + INTERVAL '1 day', $2, NOW(), $5),
              ($3, NOW() + INTERVAL '1 day', $4, NOW(), $5)`,
      [
        currentSessionId,
        currentSessionToken,
        otherSessionId,
        crypto.randomUUID(),
        userId,
      ],
    );
    const { completePasswordChange, createChangeToken } = await import("@/features/account/change-tokens");
    const token = await createChangeToken({ userId, type: "password_change" });
    await expect(
      completePasswordChange({
        token,
        userId,
        currentSessionId,
        passwordHash: "new-hash",
      }),
    ).resolves.toBe(true);

    const credential = await database.query<{ password: string }>(
      `SELECT password FROM account WHERE id = $1`,
      [accountId],
    );
    expect(credential.rows[0]?.password).toBe("new-hash");
    const sessions = await database.query<{ id: string }>(
      `SELECT id FROM "session" WHERE "userId" = $1`,
      [userId],
    );
    expect(sessions.rows.map((row) => row.id)).toEqual([currentSessionId]);
    await expect(
      completePasswordChange({
        token,
        userId,
        currentSessionId,
        passwordHash: "replayed-hash",
      }),
    ).resolves.toBe(false);
  });

  it("登录设备只返回当前用户的活跃会话且不能误删当前或他人会话", async () => {
    const owner = await context.internalAdapter.createUser(
      {
        name: "Session Owner Test",
        email: `session-owner-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: "test" },
    );
    const outsider = await context.internalAdapter.createUser(
      {
        name: "Session Outsider Test",
        email: `session-outsider-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: "test" },
    );
    const currentSessionId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    const expiredSessionId = crypto.randomUUID();
    const outsiderSessionId = crypto.randomUUID();
    const {
      listActiveAccountSessions,
      revokeOtherAccountSessions,
      revokeOwnedAccountSession,
    } = await import("@/features/account/account-sessions");

    try {
      await database.query(
        `INSERT INTO "session"
           (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId")
         VALUES ($1, NOW() + INTERVAL '1 day', $2, NOW(), NOW(), '127.0.0.1', 'test-current', $7),
                ($3, NOW() + INTERVAL '1 day', $4, NOW(), NOW(), '127.0.0.2', 'test-other', $7),
                ($5, NOW() - INTERVAL '1 day', $6, NOW(), NOW(), NULL, NULL, $7),
                ($8, NOW() + INTERVAL '1 day', $9, NOW(), NOW(), '127.0.0.3', 'test-outsider', $10)`,
        [
          currentSessionId,
          crypto.randomUUID(),
          otherSessionId,
          crypto.randomUUID(),
          expiredSessionId,
          crypto.randomUUID(),
          owner.id,
          outsiderSessionId,
          crypto.randomUUID(),
          outsider.id,
        ],
      );

      const sessions = await listActiveAccountSessions(
        owner.id,
        currentSessionId,
      );
      expect(sessions.map((session) => session.id)).toEqual([
        currentSessionId,
        otherSessionId,
      ]);
      expect(sessions[0]?.current).toBe(true);
      expect(sessions[1]?.current).toBe(false);
      expect(sessions[0]).not.toHaveProperty("token");

      await expect(
        revokeOwnedAccountSession({
          userId: owner.id,
          currentSessionId,
          targetSessionId: currentSessionId,
        }),
      ).resolves.toBe("current");
      await expect(
        revokeOwnedAccountSession({
          userId: owner.id,
          currentSessionId,
          targetSessionId: outsiderSessionId,
        }),
      ).resolves.toBe("not-found");
      await expect(
        revokeOwnedAccountSession({
          userId: owner.id,
          currentSessionId,
          targetSessionId: otherSessionId,
        }),
      ).resolves.toBe("revoked");
      await expect(
        revokeOtherAccountSessions(owner.id, currentSessionId),
      ).resolves.toBe(1);

      const remaining = await database.query<{ id: string }>(
        `SELECT id FROM "session" WHERE id = ANY($1::text[]) ORDER BY id`,
        [[currentSessionId, otherSessionId, expiredSessionId, outsiderSessionId]],
      );
      expect(remaining.rows.map((row) => row.id).sort()).toEqual(
        [currentSessionId, outsiderSessionId].sort(),
      );
    } finally {
      await database.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [
        [owner.id, outsider.id],
      ]);
    }
  });

  it("并发核销同一 OTP 时只有一次成功", async () => {
    const { generateAndStoreOtp, verifyStoredOtp } = await import("@/features/account/otp");
    const email = `otp-${crypto.randomUUID()}@example.test`;
    const purpose = "integration";
    const code = await generateAndStoreOtp({ email, purpose });
    const results = await Promise.all([
      verifyStoredOtp({ email, purpose, code }),
      verifyStoredOtp({ email, purpose, code }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("格式错误的 OTP 不消耗尝试次数", async () => {
    const { generateAndStoreOtp, verifyStoredOtp } = await import("@/features/account/otp");
    const email = `otp-format-${crypto.randomUUID()}@example.test`;
    const purpose = "integration-format";
    const code = await generateAndStoreOtp({ email, purpose });

    await expect(
      verifyStoredOtp({ email, purpose, code: "12345" }),
    ).resolves.toMatchObject({ ok: false, remaining: 3 });
    await expect(
      verifyStoredOtp({ email, purpose, code }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("并发创建 API token 不会突破每账号一个的约束", async () => {
    const { createApiToken } = await import("@/features/account/api-tokens");
    const email = `api-${crypto.randomUUID()}@example.test`;
    await database.query(`UPDATE "user" SET email = $1 WHERE id = $2`, [email, userId]);
    const results = await Promise.all([
      createApiToken(userId, email),
      createApiToken(userId, email),
    ]);
    const successes = results.filter((result) => "token" in result);
    expect(successes).toHaveLength(1);
    expect(results.filter((result) => "errorCode" in result)).toHaveLength(1);
    if ("token" in successes[0]) createdApiToken = successes[0].token.token!;
  });

  it("同 IP 的大量有效 API token 请求不会被失败限流误伤", async () => {
    const { authenticateApiToken } = await import("@/features/account/api-tokens");
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
           (id, user_id, slug, revision_id, title, date, tag, description, keywords,
            size_bytes, storage_key)
         VALUES ($1, $2, $3, $4, 'invalid-date', 'not-a-date', '', '', '', 1, $5)`,
        [
          crypto.randomUUID(),
          userId,
          `bad-date-${crypto.randomUUID()}`,
          crypto.randomUUID(),
          `a_${crypto.randomUUID().replaceAll("-", "")}`,
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("通用限流在数据库中跨调用共享", async () => {
    const { consumeSharedRateLimit } = await import("@/infrastructure/database/rate-limit");
    const subject = crypto.randomUUID();
    expect((await consumeSharedRateLimit("integration", subject, 2, 60)).allowed).toBe(true);
    expect((await consumeSharedRateLimit("integration", subject, 2, 60)).allowed).toBe(true);
    expect((await consumeSharedRateLimit("integration", subject, 2, 60)).allowed).toBe(false);
  });

  it("启动回收能区分未提交和已提交的跨存储删除", async () => {
    const { moveUserDirToTrash, purgeTrash, userReportsDir } = await import(
      "@/features/reports/storage/report-storage"
    );
    const recoveryUser = await context.internalAdapter.createUser(
      {
        name: "Recovery Test",
        email: `recovery-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: "test" },
    );
    const dir = userReportsDir(recoveryUser.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/report.html`, "ok");

    // DB 删除前崩溃：用户仍存在，启动恢复 payload。
    await moveUserDirToTrash(recoveryUser.id, "guest");
    await purgeTrash();
    await expect(fs.readFile(`${dir}/report.html`, "utf8")).resolves.toBe("ok");

    // DB 删除后崩溃：用户已不存在，启动完成清理。
    const committed = await moveUserDirToTrash(recoveryUser.id, "guest");
    await database.query(`DELETE FROM "user" WHERE id = $1`, [recoveryUser.id]);
    await purgeTrash();
    await expect(fs.access(committed.trashed!)).rejects.toThrow();
    await expect(fs.access(committed.manifest!)).rejects.toThrow();
  });
});
