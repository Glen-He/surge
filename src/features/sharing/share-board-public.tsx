import { boardReportShareUrl } from "./board-report-url";
import { ReportCardLink } from "@/features/reports/board/report-card-link";
import { type ShareBoardItemView } from "@/features/sharing/share-board";

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

export function ShareBoardPublic({ title, token, items }: {
  title: string;
  token: string;
  items: ShareBoardItemView[];
}) {
  const months = new Map<string, ShareBoardItemView[]>();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    const month = months.get(key) ?? [];
    month.push(item);
    months.set(key, month);
  }

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--text-primary)] antialiased">
      <div className="account-shell">
        <div className="mb-[46px]">
          <p className="text-[13px] font-semibold tracking-[0.08em] text-[var(--text-secondary)]">SURGE 分享面板</p>
          <h1 className="mt-2 text-[32px] font-bold leading-[1.15] tracking-[-0.02em]">{title}</h1>
          <p className="mt-2 text-[15px] text-[var(--text-secondary)]">{items.length > 0 ? `共 ${items.length} 份汇报` : "暂时没有可查看的汇报"}</p>
        </div>

        {items.length === 0 ? (
          <div className="rounded-[20px] bg-[var(--surface)] px-6 py-20 text-center shadow-[0_8px_28px_rgba(0,0,0,0.025)]">
            <p className="text-[15px] font-semibold">分享者暂未添加内容</p>
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">稍后刷新此页面即可查看新增汇报</p>
          </div>
        ) : (
          <div className="space-y-14">
            {Array.from(months).map(([month, reports]) => (
              <section key={month}>
                <h2 className="mb-5 text-[18px] font-semibold text-[var(--text-secondary)]">{monthLabel(month)}</h2>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {reports.map((report) => (
                    <div key={report.id} className="group/report-card relative transition-transform duration-200 hover:-translate-y-0.5">
                      <ReportCardLink report={report} href={report.displayMode === "bare" ? boardReportShareUrl(token, report.id) : `/board/${token}/item/${report.id}`} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
