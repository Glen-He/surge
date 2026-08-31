import type { PoolClient } from "pg";
import { db } from "./db";
import { consumeSharedRateLimit } from "./db-rate-limit";
import { requireTagColor, type TagColor } from "./tag-colors";
import {
  generateShareId,
  generateShareToken,
  isValidShareToken,
  unlockProof,
  verifyUnlockProof,
} from "./shares";
import {
  decryptSharePasscode,
  decryptShareToken,
  encryptShareToken,
  shareTokenHash,
} from "./share-token-store";
import { ShareBoardError } from "./share-board-errors";

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

type BoardRow = {
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

export type PublicShareBoard = {
  id: string;
  ownerId: string;
  token: string;
  title: string;
  passwordHash: string | null;
  accessEpoch: number;
  expiresAt: Date | null;
  items: ShareBoardItemView[];
};

export type PublicBoardReport = {
  boardId: string;
  boardOwnerId: string;
  boardTitle: string;
  boardToken: string;
  boardPasswordHash: string | null;
  boardAccessEpoch: number;
  boardExpiresAt: Date | null;
  reportId: string;
  reportTitle: string;
  revisionId: string;
  capabilityEpoch: number;
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

function toSummary(row: BoardRow): ShareBoardSummary {
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

export function boardUnlockCookieName(token: string): string {
  return `board_${token}`;
}

export function boardUnlockProof(token: string, accessEpoch: number): string {
  return unlockProof(`board:${token}:${accessEpoch}`);
}

export function verifyBoardUnlockProof(
  token: string,
  accessEpoch: number,
  proof?: string,
): boolean {
  return verifyUnlockProof(`board:${token}:${accessEpoch}`, proof);
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

function itemFromRow(row: {
  item_id: string;
  slug: string;
  date: string;
  tag: string;
  tag_color: string;
  title: string;
  description: string;
  keywords: string;
}): ShareBoardItemView {
  return {
    id: row.item_id,
    slug: row.slug,
    date: row.date,
    tag: row.tag || "其他",
    tagColor: requireTagColor(row.tag_color),
    title: row.title,
    desc: row.description,
    keywords: row.keywords ? row.keywords.split(",").filter(Boolean) : [],
  };
}

export async function findPublicShareBoard(token: string): Promise<PublicShareBoard | null> {
  if (!isValidShareToken(token)) return null;
  const board = await db.query<BoardRow>(
    `SELECT * FROM share_boards
     WHERE token_hash = $1 AND disabled_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [shareTokenHash(token)],
  );
  const row = board.rows[0];
  if (!row) return null;
  const items = await db.query<{
    item_id: string;
    slug: string;
    date: string;
    tag: string;
    tag_color: string;
    title: string;
    description: string;
    keywords: string;
  }>(
    `SELECT i.id AS item_id, r.slug, r.date, r.tag, r.tag_color,
            r.title, r.description, r.keywords
       FROM share_board_items i
       JOIN reports r ON r.id = i.report_id
      WHERE i.board_id = $1
      ORDER BY r.date DESC, r.sort_order ASC NULLS LAST, r.created_at DESC`,
    [row.id],
  );
  return {
    id: row.id,
    ownerId: row.user_id,
    token,
    title: row.title,
    passwordHash: row.password_hash,
    accessEpoch: row.access_epoch,
    expiresAt: row.expires_at,
    items: items.rows.map(itemFromRow),
  };
}

export async function findPublicBoardReport(
  token: string,
  itemId: string,
): Promise<PublicBoardReport | null> {
  const result = await db.query<{
    board_id: string;
    board_owner_id: string;
    board_title: string;
    password_hash: string | null;
    access_epoch: number;
    expires_at: Date | null;
    report_id: string;
    report_title: string;
    revision_id: string;
    capability_epoch: number;
  }>(
    `SELECT b.id AS board_id, b.user_id AS board_owner_id, b.title AS board_title,
            b.password_hash, b.access_epoch, b.expires_at,
            r.id AS report_id, r.title AS report_title,
            r.revision_id, r.capability_epoch
       FROM share_boards b
       JOIN share_board_items i ON i.board_id = b.id
       JOIN reports r ON r.id = i.report_id
      WHERE b.token_hash = $1 AND b.disabled_at IS NULL
        AND (b.expires_at IS NULL OR b.expires_at > NOW()) AND i.id = $2
      LIMIT 1`,
    [shareTokenHash(token), itemId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    boardId: row.board_id,
    boardOwnerId: row.board_owner_id,
    boardTitle: row.board_title,
    boardToken: token,
    boardPasswordHash: row.password_hash,
    boardAccessEpoch: row.access_epoch,
    boardExpiresAt: row.expires_at,
    reportId: row.report_id,
    reportTitle: row.report_title,
    revisionId: row.revision_id,
    capabilityEpoch: row.capability_epoch,
  };
}

export async function incrementBoardView(token: string): Promise<void> {
  await db.query(`UPDATE share_boards SET view_count = view_count + 1 WHERE token_hash = $1`, [shareTokenHash(token)]);
}

export async function shouldCountBoardView(token: string, ip: string): Promise<boolean> {
  return (await consumeSharedRateLimit("board-view", `${token}:${ip}`, 1, 60 * 60)).allowed;
}
