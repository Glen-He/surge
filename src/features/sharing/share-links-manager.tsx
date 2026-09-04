import Link from "next/link";
import { shareStatus } from "@/features/sharing/report-share";
import { ShareManagementEmptyState } from "@/features/sharing/share-management-empty-state";
import { ShareRowActions } from "@/features/sharing/share-row-actions";

export type ManagedShareLink = {
  id: string;
  token: string;
  passcode: string | null;
  expires_at: Date | null;
  view_count: number;
  created_at: Date;
  report_title: string;
  report_slug: string;
};

function fmtDate(date: Date | null): string {
  if (!date) return "—";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

const STATUS_CLASS = {
  active: "bg-[#e9fbe9] text-[#166534]",
  expired: "bg-[#f2f2f7] text-[#6e6e73]",
} as const;

const STATUS_LABEL = {
  active: "生效中",
  expired: "已过期",
} as const;

/** 分享链接在桌面与手机统一使用管理卡片，避免窄屏压缩多列表格。 */
export function ShareLinksManager({
  rows,
}: {
  rows: ManagedShareLink[];
}) {
  return (
    <section>
      <div className="mb-5">
        <h2 className="text-[21px] font-semibold tracking-[-0.01em]">
          分享链接
        </h2>
        <p className="mt-1 text-[13px] text-[#6e6e73]">
          适合只发送一份汇报，可使用独立的 4 位提取码和有效期。
        </p>
      </div>

      {rows.length === 0 ? (
        <ShareManagementEmptyState
          title="还没有分享链接"
          hint="在项目卡片的分享按钮或报告页的分享按钮里生成链接，都会汇总在这里管理。"
        />
      ) : (
        <div
          data-share-links-grid
          className="grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          {rows.map((share) => {
            const status = shareStatus(share);
            return (
              <article
                key={share.id}
                data-share-link-card
                className="flex h-[208px] min-w-0 flex-col rounded-[20px] bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.025)]"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/report/${share.report_slug}`}
                      className="block truncate text-[17px] font-semibold hover:text-[#0071e3]"
                    >
                      {share.report_title}
                    </Link>
                    <p className="mt-1 truncate text-[12px] text-[#6e6e73]">
                      {share.passcode
                        ? `提取码 ${share.passcode}`
                        : "无需提取码"}
                      {" · "}
                      {share.expires_at
                        ? `${fmtDate(share.expires_at)} 到期`
                        : "长期有效"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </div>

                <div className="mt-5 flex items-end gap-10">
                  <div>
                    <p className="text-[11px] text-[#86868b]">浏览次数</p>
                    <p className="mt-1 text-[14px] font-semibold tabular-nums">
                      {Number(share.view_count)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#86868b]">创建时间</p>
                    <p className="mt-1 text-[14px] font-medium tabular-nums">
                      {fmtDate(share.created_at)}
                    </p>
                  </div>
                </div>

                <div className="mt-auto flex justify-end pt-4">
                  <ShareRowActions
                    shareId={share.id}
                    token={share.token}
                    passcode={share.passcode}
                    active={status === "active"}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
