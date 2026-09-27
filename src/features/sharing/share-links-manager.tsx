import type { DisplayMode } from "@/features/reports/display-mode";
import Link from "next/link";
import { shareStatus } from "@/features/sharing/report-share";
import { ShareManagementEmptyState } from "@/features/sharing/share-management-empty-state";
import { ShareRowActions } from "@/features/sharing/share-row-actions";

export type ManagedShareLink = {
  id: string;
  token: string;
  passcode: string | null;
  expires_at: Date | null;
  disabled_at: Date | null;
  view_count: number;
  created_at: Date;
  report_title: string;
  report_slug: string;
  display_mode: DisplayMode;
};

type ManagedReportShares = Pick<
  ManagedShareLink,
  "report_title" | "report_slug" | "display_mode"
> & {
  shares: ManagedShareLink[];
};

function fmtDate(date: Date | null): string {
  if (!date) return "—";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupShares(rows: ManagedShareLink[]): ManagedReportShares[] {
  const groups = new Map<string, ManagedReportShares>();
  for (const share of rows) {
    let group = groups.get(share.report_slug);
    if (!group) {
      group = {
        report_title: share.report_title,
        report_slug: share.report_slug,
        display_mode: share.display_mode,
        shares: [],
      };
      groups.set(share.report_slug, group);
    }
    group.shares.push(share);
  }
  return [...groups.values()];
}

const STATUS_CLASS = {
  active: "bg-[var(--success-soft)] text-[var(--success-text)]",
  expired: "bg-[var(--control-bg)] text-[var(--text-secondary)]",
  paused: "bg-[var(--control-bg)] text-[var(--text-secondary)]",
} as const;

const STATUS_LABEL = {
  active: "生效中",
  expired: "已过期",
  paused: "已暂停",
} as const;

/** 每份汇报使用一张固定尺寸卡片，链接数量变化只影响卡片内的滚动列表。 */
export function ShareLinksManager({
  rows,
}: {
  rows: ManagedShareLink[];
}) {
  const reports = groupShares(rows);

  return (
    <section>
      <div className="mb-5">
        <h2 className="type-section-title tracking-[-0.01em]">
          分享链接
        </h2>
        <p className="mt-1 type-caption text-[var(--text-secondary)]">
          每份汇报集中管理多条独立链接，可分别设置提取码、有效期和访问状态。
        </p>
      </div>

      {reports.length === 0 ? (
        <ShareManagementEmptyState
          title="还没有分享链接"
          hint="在项目卡片的分享按钮或报告页的分享按钮里生成链接，都会汇总在这里管理。"
        />
      ) : (
        <div data-share-links-grid className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {reports.map((report) => {
            const viewCount = report.shares.reduce(
              (total, share) => total + Number(share.view_count),
              0,
            );
            const href = `/view/${report.report_slug}`;
            const newTab = report.display_mode === "bare";

            return (
              <article
                key={report.report_slug}
                data-share-link-card
                data-report-slug={report.report_slug}
                className="flex min-w-0 flex-col rounded-[var(--radius-xl)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.025)]"
                style={{ height: 270, minHeight: 270, maxHeight: 270 }}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={href}
                      target={newTab ? "_blank" : undefined}
                      rel={newTab ? "noopener noreferrer" : undefined}
                      className="block truncate type-card-title hover:text-[var(--accent-text)]"
                    >
                      {report.report_title}
                    </Link>
                    <p className="mt-1 truncate type-caption text-[var(--text-secondary)]">
                      {report.shares.length} 条链接 · {viewCount} 次浏览
                    </p>
                  </div>
                  {newTab && (
                    <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 type-badge text-[var(--accent-text)]">
                      网页
                    </span>
                  )}
                </div>

                <div className="mt-4 h-[118px] shrink-0 space-y-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {report.shares.map((share) => {
                    const status = shareStatus(share);
                    const details = [
                      share.passcode ? `提取码 ${share.passcode}` : "无需提取码",
                      share.expires_at
                        ? `${fmtDate(share.expires_at)} 到期`
                        : "长期有效",
                      `${Number(share.view_count)} 次浏览`,
                    ].join(" · ");

                    return (
                      <div
                        key={share.id}
                        data-share-item={share.id}
                        className="flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-2"
                      >
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 type-badge ${STATUS_CLASS[status]}`}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate type-caption text-[var(--text-secondary)]"
                        >
                          <time dateTime={share.created_at.toISOString()}>
                            {fmtDate(share.created_at)}
                          </time>
                          {" · "}
                          {details}
                        </span>
                        <ShareRowActions
                          shareId={share.id}
                          token={share.token}
                          passcode={share.passcode}
                          active={status === "active"}
                          disabled={status === "paused"}
                          expiresAt={share.expires_at?.toISOString() ?? null}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="mt-auto flex justify-end pt-4">
                  <Link
                    href={href}
                    target={newTab ? "_blank" : undefined}
                    rel={newTab ? "noopener noreferrer" : undefined}
                    className="inline-flex h-8 w-[96px] items-center justify-center gap-1 rounded-full bg-[var(--accent)] type-control-sm text-[var(--text-on-fill)] transition-colors hover:bg-[var(--accent-hover)]"
                  >
                    {newTab ? "打开网页" : "打开汇报"}
                    {newTab && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-3 w-3"
                        aria-hidden="true"
                      >
                        <path d="M14 5h5v5M19 5l-8 8" />
                        <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
                      </svg>
                    )}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
