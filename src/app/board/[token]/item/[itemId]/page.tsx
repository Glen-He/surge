import { BoardReportView } from "@/features/sharing/board-report-view";

export default async function ShareBoardReportPage({ params }: {
  params: Promise<{ token: string; itemId: string }>;
}) {
  return <BoardReportView {...await params} />;
}
