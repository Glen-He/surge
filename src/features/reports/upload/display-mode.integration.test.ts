import { withSchemaInitializationLock } from "@/infrastructure/database/schema-initialization";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { auth } from "@/features/auth/auth";
import { db } from "@/infrastructure/database/client";
import { ensureSchemaVersioned } from "@/infrastructure/database/migrations";
import { ensureBetterAuthSchemaCompatible } from "@/infrastructure/auth/better-auth-migration";
import { REPORT_DISPLAY_MODE } from "@/infrastructure/database/migrations/027-report-display-mode";
import { getReportBySlug } from "../data/reports-db";
import { userReportsDir } from "../storage/report-storage";
import { createReport, replaceReportFile, type UploadFile } from "./upload-report";
import { updateReportMeta } from "./update-report-meta";
import { deleteReport } from "./delete-report";
import { createReportShare, findValidShare } from "@/features/sharing/report-share";
import { createShareBoard, setBoardMembership, updateShareBoard } from "@/features/sharing/share-board";
import { findPublicBoardReport, findPublicShareBoard } from "@/features/sharing/public-share-board";

describe.skipIf(process.env.SURGE_DB_INTEGRATION !== "1")("展示模式存储与分享", () => {
  let userId = "";
  let inputDir = "";
  let file: UploadFile;
  const email = `display-mode-${crypto.randomUUID()}@example.test`;
  const meta = { title: "网页测试", date: "2026-09-26", tag: "", tagColor: "#DBEAFE", description: "", keywords: "" };

  beforeAll(async () => {
    const context = await auth.$context;
    await withSchemaInitializationLock(async () => {
      await ensureBetterAuthSchemaCompatible();
      await context.runMigrations();
      await ensureSchemaVersioned();
    });
    userId = (await context.internalAdapter.createUser({ name: "Display mode test", email, emailVerified: true }, { method: "test" })).id;
    inputDir = await fs.mkdtemp(path.join(os.tmpdir(), "surge-mode-input-"));
    const html = "<!doctype html><html><body>website</body></html>";
    file = { name: "site.html", type: "text/html", path: path.join(inputDir, "site.html"), size: Buffer.byteLength(html) };
    await fs.writeFile(file.path, html);
  }, 30_000);

  afterAll(async () => {
    if (userId) {
      await db.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await fs.rm(userReportsDir(userId), { recursive: true, force: true });
    }
    if (inputDir) await fs.rm(inputDir, { recursive: true, force: true });
  });

  it("迁移为存量记录回填 frame，并拒绝未知模式", async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // 临时表遮蔽正式表，直接验证同一迁移 SQL 对存量数据的效果。
      await client.query("CREATE TEMP TABLE reports (id TEXT PRIMARY KEY) ON COMMIT DROP");
      await client.query("INSERT INTO reports (id) VALUES ('existing')");
      for (const statement of REPORT_DISPLAY_MODE.statements) await client.query(statement);
      expect((await client.query("SELECT display_mode FROM reports")).rows[0].display_mode).toBe("frame");
      await expect(client.query("UPDATE reports SET display_mode = 'unknown'")).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("上传、编辑与文件替换正确保存模式；模式切换使旧 capability 失效", async () => {
    const created = await createReport(userId, email, meta, file);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("test report creation failed");
    expect((await getReportBySlug(userId, created.slug))?.display_mode).toBe("frame");
    expect(await updateReportMeta(userId, created.slug, { ...meta, displayMode: "bare" })).toMatchObject({ ok: true });
    let report = await getReportBySlug(userId, created.slug);
    expect(report).toMatchObject({ display_mode: "bare", capability_epoch: 1 });
    expect(await updateReportMeta(userId, created.slug, meta)).toMatchObject({ ok: true });
    expect(await replaceReportFile(userId, created.slug, file)).toMatchObject({ ok: true });
    const replaced = await getReportBySlug(userId, created.slug);
    expect(replaced?.display_mode).toBe("bare");
    expect(replaced?.revision_id).not.toBe(report?.revision_id);
    expect(await updateReportMeta(userId, created.slug, { ...meta, displayMode: "invalid" })).toMatchObject({ code: "META_DISPLAY_MODE_INVALID" });
    expect((await getReportBySlug(userId, created.slug))?.display_mode).toBe("bare");
    expect(await replaceReportFile(userId, created.slug, file, { ...meta, displayMode: "frame" })).toMatchObject({ ok: true });
    report = await getReportBySlug(userId, created.slug);
    expect(report?.display_mode).toBe("frame");
  });

  it("网页沿用分享过期、面板停用、成员移除与报告删除规则", async () => {
    const created = await createReport(userId, email, { ...meta, displayMode: "bare" }, file);
    if (!created.ok) throw new Error("test website creation failed");
    const share = await createReportShare({ userEmail: "owner@example.test", userId, slug: created.slug, passwordProtected: false });
    expect(share.token).toMatch(/^[a-z0-9]{8}$/);
    expect(await findValidShare(share.token!)).toMatchObject({ displayMode: "bare" });
    await db.query("UPDATE report_shares SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [share.id]);
    expect(await findValidShare(share.token!)).toBeNull();
    const board = await createShareBoard(userId, "网页面板", null, null, null, created.slug);
    expect(board.token).toMatch(/^[a-z0-9]{8}$/);
    const publicBoard = await findPublicShareBoard(board.token!);
    const itemId = publicBoard!.items[0].id;
    expect(publicBoard!.items[0].displayMode).toBe("bare");
    expect(await findPublicBoardReport(board.token!, itemId)).toMatchObject({ displayMode: "bare" });
    await updateShareBoard(userId, board.id, { disabled: true });
    expect(await findPublicBoardReport(board.token!, itemId)).toBeNull();
    await updateShareBoard(userId, board.id, { disabled: false, expiresAt: new Date(Date.now() - 1000) });
    expect(await findPublicBoardReport(board.token!, itemId)).toBeNull();
    await updateShareBoard(userId, board.id, { expiresAt: null });
    await setBoardMembership(userId, board.id, created.slug, false);
    expect(await findPublicBoardReport(board.token!, itemId)).toBeNull();
    const liveShare = await createReportShare({ userEmail: "owner@example.test", userId, slug: created.slug, passwordProtected: false });
    expect(await deleteReport(userId, created.slug)).toMatchObject({ ok: true });
    expect(await findValidShare(liveShare.token!)).toBeNull();
  });
});
