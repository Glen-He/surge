import Link from "next/link";
import { listAllShares } from "@/features/sharing/report-share";
import { requireSession } from "@/features/session/session";
import { listShareBoardsWithItems } from "@/features/sharing/share-board";
import { ShareBoardsManager } from "@/features/sharing/share-boards-manager";
import { ShareLinksManager } from "@/features/sharing/share-links-manager";

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

        <ShareLinksManager rows={rows} />
      </div>
    </main>
  );
}
