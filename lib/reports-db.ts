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

// 查某用户的所有报告：日期永远是第一排序键；同一天才使用手动顺序。
export async function getReportsByUser(userId: string): Promise<DbReport[]> {
  await ensureOtpMigration();
  const r = await db.query<DbReport>(
    `SELECT * FROM reports WHERE user_id = $1
     ORDER BY date DESC, sort_order ASC NULLS LAST, created_at DESC`,
    [userId],
  );
  return r.rows;
}

export type ReportOrderItem = { slug: string; date: string };

// 持久化完整展示顺序；跨日期拖动时同时更新日期。
export async function reorderReports(
  userId: string,
  items: ReportOrderItem[],
): Promise<void> {
  await db.query(
    `UPDATE reports AS r
     SET sort_order = ordered.ordinality - 1,
         date = ordered.date
     FROM unnest($2::text[], $3::text[])
       WITH ORDINALITY AS ordered(slug, date, ordinality)
     WHERE r.user_id = $1 AND r.slug = ordered.slug`,
    [
      userId,
      items.map((item) => item.slug),
      items.map((item) => item.date),
    ],
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
