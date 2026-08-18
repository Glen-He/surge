import { getReportsByUser } from "./reports-db";

// 卡片视图模型（与旧静态类型对齐，供 ReportCenter 使用）
export type ReportCardView = {
  slug: string;
  date: string;
  tag: string;
  tagClass: "t-kttks" | "t-nexus" | "t-vela" | "t-other";
  title: string;
  desc: string;
  keywords: string[];
};

const TAG_CLASSES = ["t-kttks", "t-nexus", "t-vela", "t-other"] as const;

// 按标签名分配稳定的配色
function tagClassFor(tag: string): ReportCardView["tagClass"] {
  const i = Math.abs(
    [...tag].reduce((a, c) => a + c.charCodeAt(0), 0),
  ) % TAG_CLASSES.length;
  return TAG_CLASSES[i];
}

export async function getReportCards(
  userId: string,
): Promise<ReportCardView[]> {
  const rows = await getReportsByUser(userId);
  return rows.map((r) => ({
    slug: r.slug,
    date: r.date,
    tag: r.tag || "其他",
    tagClass: tagClassFor(r.tag || "其他"),
    title: r.title,
    desc: r.description,
    keywords: r.keywords ? r.keywords.split(",").filter(Boolean) : [],
  }));
}
