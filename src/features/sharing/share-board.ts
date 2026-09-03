import type { PoolClient } from "pg";
import { db } from "@/infrastructure/database/client";
import type { TagColor } from "@/features/reports/tag-colors";
import {
  generateShareId,
  generateShareToken,
} from "./report-share";
import {
  decryptSharePasscode,
  decryptShareToken,
  encryptShareToken,
  shareTokenHash,
} from "./share-credentials";
import { ShareBoardError } from "@/features/sharing/share-board-errors";

// ── 分享面板（管理端）：面板 CRUD、条目成员、令牌轮换 ──
// 公开读取/解锁在 public-share-board.ts；本模块只服务属主管理流程。

const MAX_SHARE_BOARDS = 20;
const MAX_BOARD_ITEMS = 100;
export const MAX_BOARD_TITLE_LENGTH = 40;

export type ShareBoardSummary = {
  id: string;
  token: string;
  title: string;
  hasPassword: boolean;
  passcode: string | null;
  disabled: boolean;
  viewCount: number;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
};

export type ShareBoardItemView = {
  id: string;
  slug: string;
  date: string;
  tag: string;
  tagColor: TagColor;
  title: string;
  desc: string;
  keywords: string[];
};

export type ShareBoardManageView = ShareBoardSummary & {
  items: Pick<ShareBoardItemView, "slug" | "date" | "title">[];
};

export type BoardRow = {
  id: string;
  user_id: string;
  token_enc: string;
  title: string;
  password_hash: string | null;
  password_enc: string | null;
  disabled_at: Date | null;
  view_count: string | number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  access_epoch: number;
  item_count?: string | number;
};

export function normalizeBoardTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || Array.from(title).length > MAX_BOARD_TITLE_LENGTH) return null;
  return title;
}

/** 按产品时区把 calendar day 解析为当天结束时刻。 */
export function parseBoardExpiry(
  value: unknown,
  now = Date.now(),
): Date | null | "invalid" {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "invalid";
  }
  const [year, month, day] = value.split("-").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return "invalid";
  }
  const expiry = new Date(`${value}T23:59:59.999+08:00`);
  return expiry.getTime() > now ? expiry : "invalid";
}

export function toSummary(row: BoardRow): ShareBoardSummary {
  return {
    id: row.id,
    token: decryptShareToken(row.token_enc),
    title: row.title,
    hasPassword: !!row.password_hash,
    passcode: row.password_enc ? decryptSharePasscode(row.password_enc) : null,
    disabled: !!row.disabled_at,
    viewCount: Number(row.view_count),
    itemCount: Number(row.item_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export async function listShareBoards(userId: string): Promise<ShareBoardSummary[]> {
  const result = await db.query<BoardRow>(
    `SELECT b.*, count(i.id)::text AS item_count
       FROM share_boards b
       LEFT JOIN share_board_items i ON i.board_id = b.id
      WHERE b.user_id = $1
      GROUP BY b.id
      ORDER BY b.created_at DESC`,
    [userId],
  );
  return result.rows.map(toSummary);
}

export async function listShareBoardsWithItems(userId: string): Promise<ShareBoardManageView[]> {
  const boards = await listShareBoards(userId);
  if (boards.length === 0) return [];
  const result = await db.query<{
    board_id: string;
    slug: string;
    date: string;
    title: string;
  }>(
    `SELECT i.board_id, r.slug, r.date, r.title
       FROM share_board_items i
       JOIN share_boards b ON b.id = i.board_id
       JOIN reports r ON r.id = i.report_id
      WHERE b.user_id = $1
      ORDER BY r.date DESC, r.sort_order ASC NULLS LAST, r.created_at DESC`,
    [userId],
  );
  const byBoard = new Map<string, Pick<ShareBoardItemView, "slug" | "date" | "title">[]>();
  for (const row of result.rows) {
    const items = byBoard.get(row.board_id) ?? [];
    items.push({ slug: row.slug, date: row.date, title: row.title });
    byBoard.set(row.board_id, items);
  }
  return boards.map((board) => ({ ...board, items: byBoard.get(board.id) ?? [] }));
}

export async function listShareBoardsForReport(
  userId: string,
  slug: string,
): Promise<(ShareBoardSummary & { included: boolean })[] | null> {
  const own = await db.query<{ id: string }>(
    `SELECT id FROM reports WHERE user_id = $1 AND slug = $2 LIMIT 1`,
    [userId, slug],
  );
  const reportId = own.rows[0]?.id;
  if (!reportId) return null;
  const result = await db.query<BoardRow & { included: boolean }>(
    `SELECT b.*, count(all_items.id)::text AS item_count,
            bool_or(selected.report_id IS NOT NULL) AS included
       FROM share_boards b
       LEFT JOIN share_board_items all_items ON all_items.board_id = b.id
       LEFT JOIN share_board_items selected
         ON selected.board_id = b.id AND selected.report_id = $2
      WHERE b.user_id = $1
      GROUP BY b.id
      ORDER BY b.created_at DESC`,
    [userId, reportId],
  );
  return result.rows.map((row) => ({ ...toSummary(row), included: row.included }));
}

export async function createShareBoard(
  userId: string,
  title: string,
  passwordHash: string | null,
  passwordEnc: string | null,
  expiresAt: Date | null,
  initialReportSlug?: string,
): Promise<ShareBoardSummary> {
  const client = await db.connect();
  const id = generateShareId();
  const token = generateShareToken();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [userId]);
    const count = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM share_boards WHERE user_id = $1`,
      [userId],
    );
    if (Number(count.rows[0]?.n ?? 0) >= MAX_SHARE_BOARDS) {
      throw new ShareBoardError("BOARD_LIMIT_REACHED", {
        max: MAX_SHARE_BOARDS,
      });
    }
    let reportId: string | null = null;
    if (initialReportSlug) {
      const report = await client.query<{ id: string }>(
        `SELECT id FROM reports WHERE user_id = $1 AND slug = $2 LIMIT 1 FOR UPDATE`,
        [userId, initialReportSlug],
      );
      reportId = report.rows[0]?.id ?? null;
      if (!reportId) throw new ShareBoardError("BOARD_REPORT_NOT_FOUND");
    }
    await client.query(
      `INSERT INTO share_boards
         (id, user_id, token_hash, token_enc, title, password_hash, password_enc, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        userId,
        shareTokenHash(token),
        encryptShareToken(token),
        title,
        passwordHash,
        passwordEnc,
        expiresAt,
      ],
    );
    if (reportId) {
      await client.query(
        `INSERT INTO share_board_items (id, board_id, report_id) VALUES ($1, $2, $3)`,
        [generateShareId(), id, reportId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const now = new Date();
  return {
    id,
    token,
    title,
    hasPassword: !!passwordHash,
    passcode: passwordEnc ? decryptSharePasscode(passwordEnc) : null,
    disabled: false,
    viewCount: 0,
    itemCount: initialReportSlug ? 1 : 0,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
}

async function lockOwnedBoard(client: PoolClient, userId: string, boardId: string) {
  const result = await client.query<BoardRow>(
    `SELECT * FROM share_boards WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [boardId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new ShareBoardError("BOARD_NOT_FOUND");
  return row;
}

async function bumpBoardReportEpochs(client: PoolClient, boardId: string) {
  await client.query(
    `UPDATE reports r SET capability_epoch = capability_epoch + 1
      FROM share_board_items i
     WHERE i.board_id = $1 AND i.report_id = r.id`,
    [boardId],
  );
}

export async function setBoardMembership(
  userId: string,
  boardId: string,
  slug: string,
  included: boolean,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockOwnedBoard(client, userId, boardId);
    const report = await client.query<{ id: string }>(
      `SELECT id FROM reports WHERE user_id = $1 AND slug = $2 LIMIT 1 FOR UPDATE`,
      [userId, slug],
    );
    const reportId = report.rows[0]?.id;
    if (!reportId) throw new ShareBoardError("BOARD_REPORT_NOT_FOUND");
    if (included) {
      const count = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM share_board_items WHERE board_id = $1`,
        [boardId],
      );
      if (Number(count.rows[0]?.n ?? 0) >= MAX_BOARD_ITEMS) {
        throw new ShareBoardError("BOARD_ITEM_LIMIT_REACHED", {
          max: MAX_BOARD_ITEMS,
        });
      }
      await client.query(
        `INSERT INTO share_board_items (id, board_id, report_id)
         VALUES ($1, $2, $3) ON CONFLICT (board_id, report_id) DO NOTHING`,
        [generateShareId(), boardId, reportId],
      );
    } else {
      const removed = await client.query(
        `DELETE FROM share_board_items WHERE board_id = $1 AND report_id = $2`,
        [boardId, reportId],
      );
      if ((removed.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE reports SET capability_epoch = capability_epoch + 1 WHERE id = $1`,
          [reportId],
        );
      }
    }
    await client.query(`UPDATE share_boards SET updated_at = NOW() WHERE id = $1`, [boardId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function updateShareBoard(
  userId: string,
  boardId: string,
  changes: {
    title?: string;
    passwordHash?: string | null;
    passwordEnc?: string | null;
    disabled?: boolean;
    expiresAt?: Date | null;
  },
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const board = await lockOwnedBoard(client, userId, boardId);
    const nextDisabled = changes.disabled ?? !!board.disabled_at;
    const accessChanged =
      nextDisabled !== !!board.disabled_at ||
      changes.passwordHash !== undefined ||
      changes.expiresAt !== undefined;
    if (accessChanged) await bumpBoardReportEpochs(client, boardId);
    await client.query(
      `UPDATE share_boards
          SET title = COALESCE($3, title),
              password_hash = CASE WHEN $4::boolean THEN $5 ELSE password_hash END,
              password_enc = CASE WHEN $4::boolean THEN $6 ELSE password_enc END,
              disabled_at = CASE WHEN $7::boolean THEN NOW() ELSE NULL END,
              expires_at = CASE WHEN $8::boolean THEN $9 ELSE expires_at END,
              access_epoch = access_epoch + CASE WHEN $10::boolean THEN 1 ELSE 0 END,
              updated_at = NOW()
        WHERE id = $1 AND user_id = $2`,
      [
        boardId,
        userId,
        changes.title ?? null,
        changes.passwordHash !== undefined,
        changes.passwordHash ?? null,
        changes.passwordEnc ?? null,
        nextDisabled,
        changes.expiresAt !== undefined,
        changes.expiresAt ?? null,
        accessChanged,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateShareBoardToken(userId: string, boardId: string): Promise<string> {
  const client = await db.connect();
  const token = generateShareToken();
  try {
    await client.query("BEGIN");
    await lockOwnedBoard(client, userId, boardId);
    await bumpBoardReportEpochs(client, boardId);
    await client.query(
      `UPDATE share_boards
       SET token_hash = $3, token_enc = $4,
           access_epoch = access_epoch + 1, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [boardId, userId, shareTokenHash(token), encryptShareToken(token)],
    );
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteShareBoard(userId: string, boardId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockOwnedBoard(client, userId, boardId);
    await bumpBoardReportEpochs(client, boardId);
    await client.query(`DELETE FROM share_boards WHERE id = $1 AND user_id = $2`, [boardId, userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
