import { withSchemaInitializationLock } from "@/infrastructure/database/schema-initialization";
import { encryptSharePasscode } from "@/features/sharing/share-credentials";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/features/auth/auth";
import { db } from "@/infrastructure/database/client";
import { ensureBetterAuthSchemaCompatible } from "@/infrastructure/auth/better-auth-migration";
import { ensureSchemaVersioned } from "@/infrastructure/database/migrations";
import { initializeGuestSandbox } from "@/features/guest/guest-sandbox";
import { issueCapability, type CapabilitySource } from "@/features/reports/report-capability";
import { reportDocumentUrl } from "@/features/reports/serving/report-origin";
import { createReportShare, revokeReportShare, hashSharePassword } from "@/features/sharing/report-share";
import { rotateReportShareToken } from "@/features/sharing/rotate-report-share";
import { createShareBoard, setBoardMembership, updateShareBoard, rotateShareBoardToken, deleteShareBoard } from "@/features/sharing/share-board";
import { findPublicBoardReport, findPublicShareBoard } from "@/features/sharing/public-share-board";
import { checkOtpRateLimit } from "@/features/auth/otp-rate-limit";
import { GET } from "@/app/report/[cap]/[...path]/route";
import { withShareTokenRetry } from "@/features/sharing/share-token-retry";
import { OTP_RATE_RESERVATIONS } from "@/infrastructure/database/migrations/030-otp-rate-reservations";

describe.skipIf(process.env.SURGE_DB_INTEGRATION !== "1")("分享来源隔离与频控事务", () => {
  let userId = "";
  let report: { id: string; slug: string; revision_id: string; capability_epoch: number };
  const email = `scoped-access-${crypto.randomUUID()}@example.test`;
  beforeAll(async () => {
    const context = await auth.$context;
    await withSchemaInitializationLock(async () => {
      await ensureBetterAuthSchemaCompatible();
      await context.runMigrations();
      await ensureSchemaVersioned();
    });
    userId = (await context.internalAdapter.createUser({ name: "Scoped access test", email, emailVerified: true }, { method: "test" })).id;
    await initializeGuestSandbox(userId);
    report = (await db.query("SELECT id, slug, revision_id, capability_epoch FROM reports WHERE user_id = $1 LIMIT 1", [userId])).rows[0];
  }, 30_000);
  afterAll(async () => {
    if (userId) await db.query('DELETE FROM "user" WHERE id = $1', [userId]);
    await db.query("DELETE FROM otp_rate_reservations WHERE email = $1", [email]);
  });

  function capability(source: CapabilitySource) {
    return issueCapability(report.id, report.revision_id, report.capability_epoch, source);
  }
  async function status(cap: string, conditional = false) {
    const response = await GET(new Request(reportDocumentUrl(cap), { headers: conditional ? { "If-None-Match": "*" } : {} }), {
      params: Promise.resolve({ cap, path: ["report.html"] }),
    });
    await response.body?.cancel();
    return response.status;
  }
  async function boardGrant(token: string) {
    const board = (await findPublicShareBoard(token))!;
    const found = (await findPublicBoardReport(token, board.items[0].id))!;
    return { itemId: board.items[0].id, cap: capability({ kind: "board", id: found.membershipAccessId, epoch: found.boardAccessEpoch }) };
  }

  it("单个分享轮换与撤销不影响属主、其他分享或其他面板", async () => {
    const first = await createReportShare({ userEmail: "owner@example.test", userId, slug: report.slug, passwordProtected: true, requestedPasscode: "I0O1" });
    const second = await createReportShare({ userEmail: "owner@example.test", userId, slug: report.slug, passwordProtected: false });
    const board = await createShareBoard(userId, "来源隔离", null, null, null, report.slug);
    const firstCap = capability({ kind: "share", id: first.id, epoch: 0 });
    const otherCaps = [capability({ kind: "owner" }), capability({ kind: "share", id: second.id, epoch: 0 }), (await boardGrant(board.token)).cap];
    expect(await status(firstCap)).toBe(200);
    const rotated = await rotateReportShareToken(userId, first.id);
    expect(rotated).toMatch(/^[a-z0-9]{8}$/);
    expect(rotated).not.toBe(first.token);
    expect(await status(firstCap, true)).toBe(404);
    const nextCap = capability({ kind: "share", id: first.id, epoch: 1 });
    expect(await status(nextCap)).toBe(200);
    await revokeReportShare(userId, first.id);
    expect(await status(nextCap)).toBe(404);
    for (const cap of otherCaps) expect(await status(cap)).toBe(200);
    await expect(rotateReportShareToken("another-owner", second.id)).rejects.toMatchObject({ code: "SHARE_NOT_FOUND" });
  });

  it("移除再加入、停用、改密码、过期、轮换和删除面板均只撤销该来源", async () => {
    const board = await createShareBoard(userId, "成员隔离", null, null, null, report.slug);
    const other = await createShareBoard(userId, "其他面板", null, null, null, report.slug);
    const unaffected = (await boardGrant(other.token)).cap;
    const before = await boardGrant(board.token);
    await setBoardMembership(userId, board.id, report.slug, false);
    expect(await status(before.cap)).toBe(404);
    await setBoardMembership(userId, board.id, report.slug, true);
    await db.query("UPDATE share_board_items SET id = $1 WHERE board_id = $2", [before.itemId, board.id]);
    expect(await status(before.cap)).toBe(404);
    let current = (await boardGrant(board.token)).cap;
    expect(await status(current)).toBe(200);
    for (const change of [{ disabled: true }, { passwordHash: await hashSharePassword("AB23"), passwordEnc: encryptSharePasscode("AB23") }, { expiresAt: new Date(Date.now() - 1000) }]) {
      await updateShareBoard(userId, board.id, change);
      expect(await status(current)).toBe(404);
      await updateShareBoard(userId, board.id, { disabled: false, expiresAt: null, passwordHash: null, passwordEnc: null });
      current = (await boardGrant(board.token)).cap;
    }
    const rotated = await rotateShareBoardToken(userId, board.id);
    expect(await status(current)).toBe(404);
    const next = (await boardGrant(rotated)).cap;
    expect(await status(next)).toBe(200);
    await deleteShareBoard(userId, board.id);
    expect(await status(next)).toBe(404);
    expect(await status(unaffected)).toBe(200);
    expect(await status(capability({ kind: "owner" }))).toBe(200);
  });

  it("验证码并发只预留一次，日志不承担频控；日配额不能被冷却时间重置", async () => {
    const attempts = await Promise.all(Array.from({ length: 6 }, () => checkOtpRateLimit({ email })));
    expect(attempts.filter((result) => result.ok)).toHaveLength(1);
    expect((await db.query("SELECT * FROM security_logs WHERE email = $1", [email])).rowCount).toBe(0);
    await db.query("UPDATE otp_rate_reservations SET created_at = NOW() - INTERVAL '61 seconds' WHERE email = $1", [email]);
    await db.query("INSERT INTO otp_rate_reservations (email, created_at) SELECT $1, NOW() - INTERVAL '61 seconds' FROM generate_series(1, 9)", [email]);
    expect(await checkOtpRateLimit({ email })).toMatchObject({ ok: false, reason: "daily_limit" });
  });

  it("唯一索引碰撞后事务仍可继续提交", async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE collision_tokens (token TEXT) ON COMMIT DROP");
      await client.query("CREATE UNIQUE INDEX report_shares_token_hash_unique ON collision_tokens (token)");
      await client.query("INSERT INTO collision_tokens VALUES ('occupied')");
      let attempt = 0;
      const token = await withShareTokenRetry(client, "report_shares_token_hash_unique", async () => {
        const next = attempt++ === 0 ? "occupied" : "available";
        await client.query("INSERT INTO collision_tokens VALUES ($1)", [next]);
        return next;
      });
      expect(token).toBe("available");
      expect(attempt).toBe(2);
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("新建即停用写入 disabled_at，公开入口不可访问", async () => {
    const board = await createShareBoard(userId, "停用面板", null, null, null, report.slug, true);
    expect(board.disabled).toBe(true);
    expect(await findPublicShareBoard(board.token)).toBeNull();
  });

  it("频控迁移保留现行预留额度，清除过期状态且保留真正的审计事件", async () => {
    const client = await db.connect();
    const schema = `migration_test_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await client.query("CREATE TABLE security_logs (email TEXT, action TEXT, created_at TIMESTAMPTZ)");
      await client.query(`INSERT INTO security_logs VALUES
        ('UPPER@example.test', 'OTP_RATE_RESERVED', NOW()),
        ('expired@example.test', 'OTP_RATE_RESERVED', NOW() - INTERVAL '2 days'),
        ('audit@example.test', 'OTP_SENT', NOW())`);
      for (const statement of OTP_RATE_RESERVATIONS.statements) await client.query(statement);
      expect((await client.query("SELECT email FROM otp_rate_reservations")).rows).toEqual([{ email: "upper@example.test" }]);
      expect((await client.query("SELECT action FROM security_logs")).rows).toEqual([{ action: "OTP_SENT" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
