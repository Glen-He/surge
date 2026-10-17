import { requireSession } from "@/features/session/session";
import { NewReportClient } from "./new-report-client";

export default async function NewReportPage() {
  // 新建页只在登录态可用；未登录直接回登录页，避免先填表再在提交时 401。
  await requireSession();
  return <NewReportClient />;
}
