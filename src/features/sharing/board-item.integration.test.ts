import { withSchemaInitializationLock } from "@/infrastructure/database/schema-initialization";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { auth } from "@/features/auth/auth";
import { db } from "@/infrastructure/database/client";
import { ensureSchemaVersioned } from "@/infrastructure/database/migrations";
import { ensureBetterAuthSchemaCompatible } from "@/infrastructure/auth/better-auth-migration";
import { BOARD_ITEM_SHORT_ID } from "@/infrastructure/database/migrations/028-board-item-short-id";
import * as shareTokens from "./report-share";
import { createShareBoard, setBoardMembership } from "./share-board";
import { findPublicBoardReport, findPublicShareBoard } from "./public-share-board";

describe.skipIf(process.env.SURGE_DB_INTEGRATION !== "1")("面板条目短码", () => {
  let userId = "";
  const reports = Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), slug: `r_${crypto.randomUUID().slice(0, 8)}` }));

  beforeAll(async () => {
    const context = await auth.$context;
    await withSchemaInitializationLock(async () => {
      await ensureBetterAuthSchemaCompatible();
      await context.runMigrations();
      await ensureSchemaVersioned();
    });
    userId = (await context.internalAdapter.createUser({ name: "Board item test", email: `board-item-${crypto.randomUUID()}@example.test`, emailVerified: true }, { method: "test" })).id;
    for (const report of reports) {
      await db.query(`INSERT INTO reports (id, user_id, slug, revision_id, title, date, size_bytes, storage_key)
        VALUES ($1, $2, $3, $4, 'short item test', '2026-09-26', 1, $5)`,
      [report.id, userId, report.slug, crypto.randomUUID(), `a_${crypto.randomUUID().replaceAll("-", "")}`]);
    }
  }, 30_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userId) await db.query('DELETE FROM "user" WHERE id = $1', [userId]);
  });

  it("迁移保留全部成员关系和创建时间，直接替换旧标识并建立面板内唯一约束", async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TEMP TABLE share_board_items (
        id TEXT PRIMARY KEY, board_id TEXT NOT NULL, report_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL, UNIQUE (board_id, report_id)
      ) ON COMMIT DROP`);
      await client.query("CREATE INDEX share_board_items_board ON share_board_items (board_id)");
      await client.query(`INSERT INTO share_board_items
        SELECT md5(n::text), CASE WHEN n <= 100 THEN 'one' ELSE 'two' END,
          'report-' || n, '2026-09-01'::timestamptz FROM generate_series(1, 200) AS series(n)`);
      const before = await client.query("SELECT board_id, report_id, created_at FROM share_board_items ORDER BY report_id");
      for (const sql of BOARD_ITEM_SHORT_ID.statements) await client.query(sql);
      const after = await client.query("SELECT board_id, report_id, created_at FROM share_board_items ORDER BY report_id");
      expect(after.rows).toEqual(before.rows);
      const ids = await client.query<{ id: string; board_id: string }>("SELECT id, board_id FROM share_board_items");
      expect(ids.rows.every((row) => /^[a-z0-9]{4}$/.test(row.id))).toBe(true);
      expect(new Set(ids.rows.map((row) => `${row.board_id}:${row.id}`)).size).toBe(200);
      // 跨面板可重复；同面板冲突和非法格式必须由数据库拒绝。
      await client.query("INSERT INTO share_board_items VALUES ('zzzz', 'three', 'report-extra', NOW()), ('zzzz', 'four', 'report-extra', NOW())");
      for (const [id, boardId, expectedCode] of [["zzzz", "three", "23505"], ["a".repeat(32), "five", "23514"], ["AB12", "five", "23514"]]) {
        await client.query("SAVEPOINT invalid_item");
        await expect(client.query("INSERT INTO share_board_items VALUES ($1, $2, 'other-report', NOW())", [id, boardId])).rejects.toMatchObject({ code: expectedCode });
        await client.query("ROLLBACK TO SAVEPOINT invalid_item");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("创建和追加均使用短码，强制碰撞后重试，跨面板同码仍严格按 token 定位", async () => {
    const original = shareTokens.generateShareToken;
    const codes = ["aaaa", "aaaa", "b2c3", "aaaa"];
    const generated = vi.spyOn(shareTokens, "generateShareToken").mockImplementation((length = 8) => {
      if (length !== 4) return original(length);
      const next = codes.shift();
      if (!next) throw new Error("test short code sequence exhausted");
      return next;
    });
    const first = await createShareBoard(userId, "面板一", null, null, null, reports[0].slug);
    await setBoardMembership(userId, first.id, reports[1].slug, true);
    const second = await createShareBoard(userId, "面板二", null, null, null, reports[2].slug);
    expect(codes).toHaveLength(0);
    expect((await findPublicShareBoard(first.token))!.items.map((item) => item.id).sort()).toEqual(["aaaa", "b2c3"]);
    expect(await findPublicBoardReport(first.token, "aaaa")).toMatchObject({ reportId: reports[0].id });
    expect(await findPublicBoardReport(second.token, "aaaa")).toMatchObject({ reportId: reports[2].id });
    expect(await findPublicBoardReport(second.token, "b2c3")).toBeNull();
    const calls = generated.mock.calls.length;
    await Promise.all(Array.from({ length: 5 }, () => setBoardMembership(userId, first.id, reports[1].slug, true)));
    expect(generated.mock.calls.length).toBe(calls);
    expect((await findPublicShareBoard(first.token))!.items).toHaveLength(2);
  });
});
