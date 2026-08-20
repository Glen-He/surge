import { getReportsByUser } from "./reports-db";
import { fallbackTagColor, isTagColor } from "./tag-colors";

// 卡片视图模型（与旧静态类型对齐，供 ReportCenter 使用）
export type ReportCardView = {
  slug: string;
  date: string;
  tag: string;
  tagColor: string;
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
      // 存量旧数据无 tag_color：按标签文字哈希稳定映射到 7 色板
      tagColor: isTagColor(r.tag_color) ? r.tag_color : fallbackTagColor(tag),
      title: r.title,
      desc: r.description,
      keywords: r.keywords ? r.keywords.split(",").filter(Boolean) : [],
    };
  });
}
