import { db, withStorageLocks } from "@/infrastructure/database/client";

export type DbReport = {
  id: string;
  user_id: string;
  slug: string;
  revision_id: string;
  capability_epoch: number;
  title: string;
  date: string;
  tag: string;
  tag_color: string;
  description: string;
  keywords: string;
  sort_order: number | null;
  size_bytes: number;
  template_key: string | null;
  storage_key: string | null;
  created_at: Date;
};

// 查某用户的所有报告：日期永远是第一排序键；同一天才使用手动顺序。
export async function getReportsByUser(userId: string): Promise<DbReport[]> {
  const r = await db.query<DbReport>(
    `SELECT * FROM reports WHERE user_id = $1
     ORDER BY date DESC, sort_order ASC NULLS LAST, created_at DESC`,
    [userId],
  );
  return r.rows;
}

export type ReportOrderItem = { slug: string; date: string };
export type ReorderReportsResult = "updated" | "stale" | "mismatch";

// 持久化完整展示顺序；baseItems 用于拒绝其他标签页产生的过期写入。
export async function reorderReports(
  userId: string,
  items: ReportOrderItem[],
  baseItems: ReportOrderItem[],
): Promise<ReorderReportsResult> {
  return withStorageLocks(userId, async (client) => {
    await client.query("BEGIN");
    try {
      const current = await client.query<ReportOrderItem>(
        `SELECT slug, date::text
         FROM reports
         WHERE user_id = $1
         ORDER BY date DESC, sort_order ASC NULLS LAST, created_at DESC
         FOR UPDATE`,
        [userId],
      );
      const stale =
        current.rows.length !== baseItems.length ||
        current.rows.some(
          (item, index) =>
            item.slug !== baseItems[index]?.slug ||
            item.date.slice(0, 10) !== baseItems[index]?.date,
        );
      if (stale) {
        await client.query("ROLLBACK");
        return "stale";
      }

      const result = await client.query(
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
      if (result.rowCount !== items.length) {
        await client.query("ROLLBACK");
        return "mismatch";
      }
      await client.query("COMMIT");
      return "updated";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }, { global: false });
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
