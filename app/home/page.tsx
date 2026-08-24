import { getReportCards } from "@/lib/report-cards";
import { ReportBoard } from "@/components/report-board";
import { GuestSessionWatcher } from "@/components/guest-toasts";
import { isGuestEmail, getGuestExpiry } from "@/lib/guest-sandbox";
import { requireSession } from "@/lib/session";
import { purgeExpiredDeletions } from "@/lib/account-deletion";
import { RelaunchClear } from "@/components/relaunch-clear";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await purgeExpiredDeletions();

  // 未登录 → 登录页；访客沙箱到期 → 销毁并回登录页（弹回诊断日志见 lib/session）
  const session = await requireSession();

  // 访客：挂会话守望器（到期前 5 分钟提醒 + 到点自动退出）
  const guestExpiry = isGuestEmail(session.user.email)
    ? await getGuestExpiry(session.user.id)
    : null;

  // 从数据库读当前用户的报告
  const reports = await getReportCards(session.user.id);

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      {/* 登录已成功落地：清掉 Safari 续跳标记（见 components/relaunch-clear）。
          标记只应在「点登录 → 首次进入 /home」之间存活，否则 60s 内登出
          回登录页会被误判为 Safari 弹回（按钮黑锁 8s 并误报「会话同步较慢」）。
          被 307 弹回时本页不渲染，不影响真正的自动续跳。 */}
      <RelaunchClear />
      <div className="account-shell">
        {/* 页头 + 右侧按钮组（与用户中心同一视觉轴） */}
        <div className="mb-[42px] flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="whitespace-nowrap text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              工作汇报系统
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              {reports.length > 0 ? `共 ${reports.length} 个项目` : "暂无项目"}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <Link href="/guide" className="btn-light">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px]">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
              </svg>
              制作指南
            </Link>
            <Link href="/shares" className="btn-light">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px]">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              分享管理
            </Link>
            <Link href="/account" className="btn-light">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px]">
                <circle cx="12" cy="8" r="4" />
                <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
              </svg>
              用户中心
            </Link>
          </div>
        </div>

        <ReportBoard reports={reports} />
      </div>
      {guestExpiry && (
        <GuestSessionWatcher expiresAt={guestExpiry.toISOString()} />
      )}
    </main>
  );
}