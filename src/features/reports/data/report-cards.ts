import { getReportsByUser } from "@/features/reports/data/reports-db";
import { requireTagColor, type TagColor } from "@/features/reports/tag-colors";

// 卡片视图模型（与旧静态类型对齐，供 ReportCenter 使用）
export type ReportCardView = {
  slug: string;
  date: string;
  tag: string;
  tagColor: TagColor;
  title: string;
  desc: string;
  keywords: string[];
};

export async function getReportCards(
  userId: string,
): Promise<ReportCardView[]> {
  const rows = await getReportsByUser(userId);
  return rows.map((r) => {
    const tag = r.tag || "其他";
    return {
      slug: r.slug,
      date: r.date,
      tag,
      tagColor: requireTagColor(r.tag_color),
      title: r.title,
      desc: r.description,
      keywords: r.keywords ? r.keywords.split(",").filter(Boolean) : [],
    };
  });
}
