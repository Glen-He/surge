import { redirect } from "next/navigation";
import { EditReportForm } from "@/components/edit-report-form";
import { requireSession } from "@/lib/session";
import { getReportBySlug } from "@/lib/reports-db";
import { requireTagColor } from "@/lib/tag-colors";

export const dynamic = "force-dynamic";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 鉴权：未登录 → 登录页
  const session = await requireSession();

  // 归属校验：只能编辑自己的项目
  const report = await getReportBySlug(session.user.id, slug);
  if (!report) {
    redirect("/home");
  }

  return (
    <EditReportForm
      slug={report.slug}
      initial={{
        title: report.title,
        date: report.date,
        tag: report.tag,
        tagColor: requireTagColor(report.tag_color),
        keywords: report.keywords,
        description: report.description,
      }}
    />
  );
}
