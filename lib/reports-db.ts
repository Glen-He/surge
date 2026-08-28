import { db } from "./db";
import { ensureOtpMigration } from "./schema";

export type DbReport = {
  id: string;
  user_id: string;
  slug: string;
  revision_id: string;
  capability_epoch: number;
  title: string;
  date: string;
  tag: string;
  tag_color: string | null;
  description: string;
  keywords: string;
  sort_order: number | null;
  size_bytes: number;
  created_at: Date;
};

// 查某用户的所有报告（手动排序优先，其次日期倒序）
export async function getReportsByUser(userId: string): Promise<DbReport[]> {
  await ensureOtpMigration();
  const r = await db.query<DbReport>(
    `SELECT * FROM reports WHERE user_id = $1
     ORDER BY sort_order ASC NULLS LAST, date DESC, created_at DESC`,
    [userId],
  );
  return r.rows;
}

// 拖拽调序后持久化：slugs 为该用户全部项目的完整顺序
export async function reorderReports(
  userId: string,
  slugs: string[],
): Promise<void> {
  await db.query(
    `UPDATE reports AS r
     SET sort_order = ordered.ordinality - 1
     FROM unnest($2::text[]) WITH ORDINALITY AS ordered(slug, ordinality)
     WHERE r.user_id = $1 AND r.slug = ordered.slug`,
    [userId, slugs],
  );
}

// 查某用户的单个报告（用于归属校验）
export async function getReportBySlug(
  userId: string,
  slug: string,
): Promise<DbReport | null> {
  await ensureOtpMigration();
  const r = await db.query<DbReport>(
    `SELECT * FROM reports WHERE user_id = $1 AND slug = $2 LIMIT 1`,
    [userId, slug],
  );
  return r.rows[0] ?? null;
}
