import { checkShareLookupRate } from "@/features/sharing/share-lookup-rate";
import { ShareLookupNotice } from "@/features/sharing/share-lookup-notice";
import { BoardReportView } from "@/features/sharing/board-report-view";
import { cookies, headers } from "next/headers";
import { findValidShare, verifyUnlockProof, shouldCountView, incrementShareView } from "@/features/sharing/report-share";
import { clientIp } from "@/infrastructure/security/client-ip";
import { issueCapability, reportBridgeToken } from "@/features/reports/report-capability";
import { SharePasswordGate } from "@/features/sharing/share-password-gate";
import { ReportFrame } from "@/features/reports/viewer/report-frame";
import { after } from "next/server";
import { logger } from "@/infrastructure/logging/logger";
import { reportDocumentUrl } from "@/features/reports/serving/report-origin";
import { getOptionalSession } from "@/features/session/session";

// 分享落地页（无需登录）：
// - token 无效 / 已过期 → 失效提示页
// - 有密码且未解锁 → 密码门（客户端组件）
// - 其余 → 验证通过后签发 capability，iframe 指向 /report/<cap>/report.html
//   （runtime 只认 capability，不知道访问者是谁）
export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const { token } = await params;
  const { item } = await searchParams;
  if (item !== undefined) {
    return <BoardReportView token={token} itemId={typeof item === "string" ? item : ""} landing />;
  }
  const ip = clientIp(await headers());
  const lookupRate = await checkShareLookupRate(ip, token);
  if (!lookupRate.allowed) return <ShareLookupNotice retryAfter={lookupRate.retryAfter} />;
  const found = await findValidShare(token);

  if (!found) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--page-bg)] px-6">
        <div className="w-full max-w-[400px] rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--page-bg)]">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--icon-muted)" strokeWidth="1.8" className="h-6 w-6">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </div>
          <h1 className="type-card-title text-[var(--text-primary)]">链接无效或已失效</h1>
          <p className="mt-2 type-caption text-[var(--text-secondary)]">
            该分享链接不存在或已过期，请联系分享者获取新链接。
          </p>
        </div>
      </main>
    );
  }
  const session = await getOptionalSession();
  const isOwner = session?.user.id === found.ownerId;

  // 密码校验（cookie 里必须有本 token 的有效 HMAC 证明）
  if (found.share.password_hash && !isOwner) {
    const jar = await cookies();
    const proof = jar.get(`share_${token}`)?.value;
    if (!verifyUnlockProof(`share:${token}:${found.share.id}:${found.share.access_epoch}`, proof)) {
      return (
        <SharePasswordGate
          token={token}
          title={found.reportTitle}
          target="report"
        />
      );
    }
  }

  // 浏览量统计（密码通过后）：同 IP 同 token 1 小时内只计 1 次（防刷）
  // 浏览计数是旁路指标，限流存储短暂故障不能阻断报告本身。
  if (!isOwner && await shouldCountView(token, ip).catch(() => false)) {
    after(async () => {
      await incrementShareView(token).catch((error) => {
        logger.warn("share-view", "failed to record share view", error as Error);
      });
    });
  }

  const capability = issueCapability(
    found.reportId,
    found.revisionId,
    found.capabilityEpoch,
    { kind: "share", id: found.share.id, epoch: found.share.access_epoch },
    found.share.expires_at
      ? Math.floor(found.share.expires_at.getTime() / 1000)
      : undefined,
  );

  return (
    <main className="report-viewer-shell">
      {/* 系统级报告头：与登录态查看页（/view/[slug]）完全一致的 1280px 头部，
          右侧信息与返回按钮同处 40px 高的垂直带（上下居中对齐同一水平线）。
          系统头随报告正文一起滚出屏幕，报告 iframe 始终保持真实视口。 */}
      {found.displayMode === "frame" && <header className="rpt-sys-head">
        <h1 className="rpt-sys-title">{found.reportTitle}</h1>
        <div className="flex h-[40px] shrink-0 items-center">
          <span className="text-[13px] text-[var(--text-secondary)]">
            分享页面 · 来自 SURGE 工作汇报系统
          </span>
        </div>
      </header>}
      {/*
        sandbox 允许脚本、下载和用户触发的新标签页，但不带 allow-same-origin：
        报告脚本可执行（图表正常渲染），但运行于 opaque origin——
        读不到 cookie/storage、fetch 不带凭证、无法触碰父页 DOM。
        文档响应另带 CSP（connect-src 'none' 等）作为第二道防线。
      */}
      {/* capability 到期时间 clamp 到分享自身截止时间：分享 18:00 到期时，
          17:59 签出的 capability 不会活过 18:00 */}
      <ReportFrame
        displayMode={found.displayMode}
        src={reportDocumentUrl(capability)}
        title={found.reportTitle}
        bridgeToken={reportBridgeToken(capability)}
      />
    </main>
  );
}
