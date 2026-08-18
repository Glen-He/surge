import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EditReportForm } from "@/components/edit-report-form";
import { auth } from "@/lib/auth";
import { getReportBySlug } from "@/lib/reports-db";

export const dynamic = "force-dynamic";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 鉴权：未登录跳登录页
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/");
  }

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
        keywords: report.keywords,
        description: report.description,
      }}
    />
  );
}
