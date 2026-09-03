import Link from "next/link";
import { listAllShares, shareStatus } from "@/features/sharing/report-share";
import { ShareRowActions } from "@/features/sharing/share-row-actions";
import { requireSession } from "@/features/auth/session";
import { listShareBoardsWithItems } from "@/features/sharing/share-board";
import { ShareBoardsManager } from "@/features/sharing/share-boards-manager";
import { ShareManagementEmptyState } from "@/features/sharing/share-management-empty-state";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const STATUS_CLASS: Record<string, string> = {
  active: "bg-[#e9fbe9] text-[#166534]",
  expired: "bg-[#f2f2f7] text-[#6e6e73]",
};
const STATUS_LABEL: Record<string, string> = {
  active: "生效中",
  expired: "已过期",
};

export default async function SharesPage() {
  // 未登录 → 登录页；游客沙箱到期 → 销毁并回登录页
  const session = await requireSession();

  const [rows, boards] = await Promise.all([
    listAllShares(session.user.id),
    listShareBoardsWithItems(session.user.id),
  ]);
  const minExpiryDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      <div className="account-shell">
        {/* 页头 + 返回（与用户中心同一视觉轴） */}
        <div className="mb-[42px] flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="whitespace-nowrap text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              分享管理
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              {boards.length > 0 || rows.length > 0
                ? `${boards.length} 个分享面板 · ${rows.length} 条分享链接`
                : "暂无分享内容"}
            </p>
          </div>
          <Link href="/home" className="btn-light">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            返回
          </Link>
        </div>

        <ShareBoardsManager
          minExpiryDate={minExpiryDate}
          initialBoards={boards.map((board) => ({
            id: board.id,
            token: board.token,
            title: board.title,
            hasPassword: board.hasPassword,
            passcode: board.passcode,
            disabled: board.disabled,
            viewCount: board.viewCount,
            itemCount: board.itemCount,
            expiresAt: board.expiresAt?.toISOString() ?? null,
            items: board.items,
          }))}
        />

        <div className="mb-5">
          <h2 className="text-[21px] font-semibold tracking-[-0.01em]">分享链接</h2>
          <p className="mt-1 text-[13px] text-[#6e6e73]">适合只发送一份汇报，可使用独立的 4 位提取码和有效期。</p>
        </div>

        {rows.length === 0 ? (
          <ShareManagementEmptyState
            title="还没有分享链接"
            hint="在项目卡片的分享按钮或报告页的分享按钮里生成链接，都会汇总在这里管理。"
          />
        ) : (
          <div className="overflow-hidden rounded-[16px] border border-black/8 bg-white">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-black/8 bg-[#f9f9fb] text-left text-[12px] text-[#6e6e73]">
                  <th className="px-5 py-3 font-semibold">状态</th>
                  <th className="px-5 py-3 font-semibold">报告</th>
                  <th className="px-5 py-3 font-semibold">保护</th>
                  <th className="px-5 py-3 font-semibold">有效期</th>
                  <th className="px-5 py-3 text-right font-semibold">浏览</th>
                  <th className="px-5 py-3 text-right font-semibold">创建时间</th>
                  <th className="px-5 py-3 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const st = shareStatus(s);
                  return (
                    <tr key={s.id} className="border-b border-black/5 last:border-0">
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[st]}`}>
                          {STATUS_LABEL[st]}
                        </span>
                      </td>
                      <td className="max-w-[260px] truncate px-5 py-3.5 font-medium">
                        <Link href={`/report/${s.report_slug}`} className="hover:text-[#0071e3]">
                          {s.report_title}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-[#6e6e73]">
                        {s.passcode ? `提取码 ${s.passcode}` : "公开"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-[#6e6e73]">
                        {s.expires_at ? fmtDate(s.expires_at) : "永久"}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-[#6e6e73]">
                        {Number(s.view_count)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-[#6e6e73]">
                        {fmtDate(s.created_at)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <ShareRowActions
                          shareId={s.id}
                          token={s.token}
                          passcode={s.passcode}
                          active={st === "active"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
