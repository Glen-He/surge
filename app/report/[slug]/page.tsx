import Link from "next/link";
import { redirect } from "next/navigation";
import { getReportBySlug } from "@/lib/reports-db";
import { requireSession } from "@/lib/session";
import { ReportShareButton } from "@/components/report-share-button";
import { ReportFrame } from "@/components/report-frame";
import { GuestSessionWatcher } from "@/components/guest-toasts";
import { getGuestExpiry, isGuestEmail } from "@/lib/guest-sandbox";

export const dynamic = "force-dynamic";

// 报告查看器（登录态）：只负责系统头（标题/分享/返回），
// 报告本体统一由 /api/reports/[slug]/page 以完整文档返回，
// 在 sandbox iframe（opaque origin）内渲染——用户 HTML 绝不进入主站 DOM。
export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 鉴权：未登录 → 登录页；访客沙箱到期 → 销毁并回登录页
  const session = await requireSession();

  // 归属校验：从数据库确认该报告属于当前用户
  const report = await getReportBySlug(session.user.id, slug);
  if (!report) {
    redirect("/home");
  }

  const guestExpiry = isGuestEmail(session.user.email)
    ? await getGuestExpiry(session.user.id)
    : null;

  return (
    <>
      {/* 系统级报告头：所有报告页统一提供标题 + 返回，不依赖提交的 HTML */}
      <header className="rpt-sys-head">
        <h1 className="rpt-sys-title">{report.title}</h1>
        <div className="flex shrink-0 items-center gap-2.5">
          <ReportShareButton slug={slug} title={report.title} />
          <Link href="/home" className="rpt-sys-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            返回
          </Link>
        </div>
      </header>
      {/*
        sandbox="allow-scripts" 且不带 allow-same-origin：
        报告脚本可执行（图表正常渲染），但运行于 opaque origin——
        读不到 cookie/storage、fetch 不带凭证、无法触碰父页 DOM。
        文档响应另带 CSP（sandbox allow-scripts 等）作为第二道防线。
        iframe 随报告内容自适应高度，本页整体滚动（头部随内容一起滚走）。
      */}
      <ReportFrame src={`/api/reports/${slug}/page`} title={report.title} />
      {guestExpiry && (
        <GuestSessionWatcher expiresAt={guestExpiry.toISOString()} />
      )}
    </>
  );
}
