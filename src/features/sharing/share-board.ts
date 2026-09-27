import { withShareTokenRetry } from "./share-token-retry";
import type { DisplayMode } from "@/features/reports/display-mode";
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
import { shareExpiryDate, parseShareExpiryDays } from "@/features/sharing/share-expiry";
import type { ShareExpiryDays } from "@/features/sharing/share-expiry";

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
  displayMode: DisplayMode;
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
  items: {
    slug: string;
    sharedAt: Date;
    title: string;
    displayMode: DisplayMode;
  }[];
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

/** 面板有效期档位（天，0 = 永久）换算为到期时刻；非预设档位抛业务错误。 */
export function boardExpiryFromDays(value: unknown): Date | null {
  const days: ShareExpiryDays | null = parseShareExpiryDays(value);
  if (days === null) throw new ShareBoardError("BOARD_EXPIRY_INVALID");
  return shareExpiryDate(days);
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
    display_mode: DisplayMode;
    board_id: string;
    slug: string;
    shared_at: Date;
    title: string;
  }>(
    `SELECT i.board_id, i.created_at AS shared_at, r.slug, r.title, r.display_mode
       FROM share_board_items i
       JOIN share_boards b ON b.id = i.board_id
       JOIN reports r ON r.id = i.report_id
      WHERE b.user_id = $1
      ORDER BY r.date DESC, r.sort_order ASC NULLS LAST, r.created_at DESC`,
    [userId],
  );
  const byBoard = new Map<string, ShareBoardManageView["items"]>();
  for (const row of result.rows) {
    const items = byBoard.get(row.board_id) ?? [];
    items.push({
      slug: row.slug,
      sharedAt: row.shared_at,
      title: row.title,
      displayMode: row.display_mode,
    });
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
  disabled = false,
): Promise<ShareBoardSummary> {
  const client = await db.connect();
  const id = generateShareId();
  let token = "";
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
    await withShareTokenRetry(client, "share_boards_token_hash_unique", async () => {
      token = generateShareToken();
      await client.query(
        `INSERT INTO share_boards
           (id, user_id, token_hash, token_enc, title, password_hash, password_enc, expires_at, disabled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          userId,
          shareTokenHash(token),
          encryptShareToken(token),
          title,
          passwordHash,
          passwordEnc,
          expiresAt,
          disabled ? new Date() : null,
        ],
      );
    });
    if (reportId) {
      await insertBoardItem(client, id, reportId);
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
    disabled,
    viewCount: 0,
    itemCount: initialReportSlug ? 1 : 0,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
}

// 调用方已锁定面板或刚创建面板；同一报告重复加入时保留原短码。
async function insertBoardItem(client: PoolClient, boardId: string, reportId: string) {
  const existing = await client.query(
    `SELECT id FROM share_board_items WHERE board_id = $1 AND report_id = $2`,
    [boardId, reportId],
  );
  if (existing.rows.length > 0) return;

  // 短码只负责面板内定位；联合主键防止碰撞，失败后重新抽样。
  for (;;) {
    const inserted = await client.query(
      `INSERT INTO share_board_items (id, board_id, report_id)
       VALUES ($1, $2, $3) ON CONFLICT (board_id, id) DO NOTHING RETURNING id`,
      [generateShareToken(4), boardId, reportId],
    );
    if (inserted.rows.length > 0) return;
  }
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
      const count = await client.query<{ n: string; already_member: boolean }>(
        `SELECT count(*)::text AS n, bool_or(report_id = $2) AS already_member
         FROM share_board_items WHERE board_id = $1`,
        [boardId, reportId],
      );
      if (!count.rows[0]?.already_member && Number(count.rows[0]?.n ?? 0) >= MAX_BOARD_ITEMS) {
        throw new ShareBoardError("BOARD_ITEM_LIMIT_REACHED", {
          max: MAX_BOARD_ITEMS,
        });
      }
      await insertBoardItem(client, boardId, reportId);
    } else {
      await client.query(
        `DELETE FROM share_board_items WHERE board_id = $1 AND report_id = $2`,
        [boardId, reportId],
      );
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
  let token = "";
  try {
    await client.query("BEGIN");
    const current = await lockOwnedBoard(client, userId, boardId);
    await withShareTokenRetry(client, "share_boards_token_hash_unique", async () => {
      do { token = generateShareToken(); } while (token === decryptShareToken(current.token_enc));
      await client.query(
        `UPDATE share_boards
         SET token_hash = $3, token_enc = $4,
             access_epoch = access_epoch + 1, updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [boardId, userId, shareTokenHash(token), encryptShareToken(token)],
      );
    });
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
    await client.query(`DELETE FROM share_boards WHERE id = $1 AND user_id = $2`, [boardId, userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
