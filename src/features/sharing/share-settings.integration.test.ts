import { withSchemaInitializationLock } from "@/infrastructure/database/schema-initialization";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/features/auth/auth";
import { db } from "@/infrastructure/database/client";
import { ensureSchemaVersioned } from "@/infrastructure/database/migrations";
import { ensureBetterAuthSchemaCompatible } from "@/infrastructure/auth/better-auth-migration";
import {
  createReportShare,
  findValidShare,
  listSharesBySlug,
  shareStatus,
  updateReportShareSettings,
  verifySharePassword,
} from "./report-share";

// 分享设置的写入路径（暂停 / 有效期 / 提取码）与公开读取的 fail closed 行为，
// 需要真实数据库（access_epoch 递增、disabled_at 生效都在 SQL 层）。
describe.skipIf(process.env.SURGE_DB_INTEGRATION !== "1")("分享设置", () => {
  let userId = "";
  const slug = `r_${crypto.randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const context = await auth.$context;
    await withSchemaInitializationLock(async () => {
      await ensureBetterAuthSchemaCompatible();
      await context.runMigrations();
      await ensureSchemaVersioned();
    });
    userId = (
      await context.internalAdapter.createUser(
        {
          name: "Share settings test",
          email: `share-settings-${crypto.randomUUID()}@example.test`,
          emailVerified: true,
        },
        { method: "test" },
      )
    ).id;
    await db.query(
      `INSERT INTO reports (id, user_id, slug, revision_id, title, date, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, 'share settings test', '2026-09-26', 1, $5)`,
      [
        crypto.randomUUID(),
        userId,
        slug,
        crypto.randomUUID(),
        `a_${crypto.randomUUID().replaceAll("-", "")}`,
      ],
    );
  }, 30_000);

  afterAll(async () => {
    if (userId) await db.query('DELETE FROM "user" WHERE id = $1', [userId]);
  });

  async function shareRow(shareId: string) {
    const rows = await listSharesBySlug(userId, slug);
    const row = rows.find((item) => item.id === shareId);
    if (!row) throw new Error("share row missing");
    return row;
  }

  it("暂停后公开读取立即失效，恢复后重新可用", async () => {
    const share = await createReportShare({
      userId,
      slug,
      passwordProtected: false,
      expiresInDays: 0,
    });
    expect(await findValidShare(share.token)).not.toBeNull();

    await updateReportShareSettings({ userId, shareId: share.id, disabled: true });
    expect(await findValidShare(share.token)).toBeNull();
    expect(shareStatus(await shareRow(share.id))).toBe("paused");

    await updateReportShareSettings({ userId, shareId: share.id, disabled: false });
    expect(await findValidShare(share.token)).not.toBeNull();
    expect(shareStatus(await shareRow(share.id))).toBe("active");
  });

  it("改动访问设置递增 access_epoch，并写入新的到期时间", async () => {
    const share = await createReportShare({
      userId,
      slug,
      passwordProtected: false,
      expiresInDays: 0,
    });
    const before = await shareRow(share.id);
    await updateReportShareSettings({ userId, shareId: share.id, expiresInDays: 7 });
    const after = await shareRow(share.id);
    expect(after.access_epoch).toBe(before.access_epoch + 1);
    expect(after.expires_at).not.toBeNull();
    expect(after.expires_at!.getTime()).toBeGreaterThan(Date.now());
    expect(shareStatus(after)).toBe("active");
  });

  it("可重新生成或清除提取码，并同步哈希", async () => {
    const share = await createReportShare({
      userId,
      slug,
      passwordProtected: true,
      expiresInDays: 0,
    });
    const result = await updateReportShareSettings({
      userId,
      shareId: share.id,
      regeneratePassword: true,
    });
    expect(result.passcode).toMatch(/^[A-Z0-9]{4}$/);
    expect(result.passcode).not.toBe(share.passcode);
    const rotated = await shareRow(share.id);
    expect(rotated.passcode).toBe(result.passcode);
    expect(await verifySharePassword(result.passcode!, rotated.password_hash!)).toBe(true);

    await updateReportShareSettings({ userId, shareId: share.id, password: null });
    const cleared = await shareRow(share.id);
    expect(cleared.password_hash).toBeNull();
    expect(cleared.passcode).toBeNull();
  });

  it("非法档位、空更新与非属主更新都被拒绝", async () => {
    const share = await createReportShare({
      userId,
      slug,
      passwordProtected: false,
      expiresInDays: 0,
    });
    await expect(
      updateReportShareSettings({ userId, shareId: share.id, expiresInDays: 3 }),
    ).rejects.toThrow(/SHARE_EXPIRY_INVALID/);
    await expect(
      updateReportShareSettings({ userId, shareId: share.id }),
    ).rejects.toThrow(/SHARE_NO_CHANGES/);
    await expect(
      updateReportShareSettings({
        userId: crypto.randomUUID(),
        shareId: share.id,
        disabled: true,
      }),
    ).rejects.toThrow(/SHARE_NOT_FOUND/);
  });
});
