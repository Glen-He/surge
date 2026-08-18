import { db } from "./db";

export type DbReport = {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  date: string;
  tag: string;
  description: string;
  keywords: string;
  sort_order: number | null;
  created_at: Date;
};

// 查某用户的所有报告（手动排序优先，其次日期倒序）
export async function getReportsByUser(userId: string): Promise<DbReport[]> {
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
  for (let i = 0; i < slugs.length; i++) {
    await db.query(
      `UPDATE reports SET sort_order = $1 WHERE user_id = $2 AND slug = $3`,
      [i, userId, slugs[i]],
    );
  }
}

// 查某用户的单个报告（用于归属校验）
export async function getReportBySlug(
  userId: string,
  slug: string,
): Promise<DbReport | null> {
  const r = await db.query<DbReport>(
    `SELECT * FROM reports WHERE user_id = $1 AND slug = $2 LIMIT 1`,
    [userId, slug],
  );
  return r.rows[0] ?? null;
}
