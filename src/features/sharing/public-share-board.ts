import { db } from "@/infrastructure/database/client";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { requireTagColor } from "@/features/reports/tag-colors";
import { isValidShareToken, unlockProof, verifyUnlockProof } from "./report-share";
import { shareTokenHash } from "./share-credentials";
import type { ShareBoardItemView, BoardRow } from "./share-board";

// ── 分享面板（公开端）：匿名访客的面板读取、解锁凭证与浏览计数 ──
// 属主管理流程在 share-board.ts。

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
