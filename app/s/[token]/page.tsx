import { cookies, headers } from "next/headers";
import { findValidShare, verifyUnlockProof, shouldCountView, incrementShareView } from "@/lib/shares";
import { clientIp } from "@/lib/client-ip";
import { issueCapability, reportBridgeToken } from "@/lib/report-capability";
import { SharePasswordGate } from "./password-gate";
import { ReportFrame } from "@/components/report-frame";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { reportDocumentUrl } from "@/lib/report-origin";
import { getOptionalSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// 分享落地页（无需登录）：
// - token 无效 / 已过期 → 失效提示页
// - 有密码且未解锁 → 密码门（客户端组件）
// - 其余 → 验证通过后签发 capability，iframe 指向 /r/<cap>/report.html
//   （runtime 只认 capability，不知道访问者是谁）
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await findValidShare(token);

  if (!found) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[#f5f5f7] px-6">
        <div className="w-full max-w-[400px] rounded-[20px] border border-black/8 bg-white p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f5f7]">
            <svg viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="1.8" className="h-6 w-6">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-[17px] font-semibold text-[#1d1d1f]">链接无效或已失效</h1>
          <p className="mt-2 text-[13px] leading-[1.55] text-[#6e6e73]">
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
    if (!verifyUnlockProof(token, proof)) {
      return (
        <SharePasswordGate token={token} title={found.reportTitle} />
      );
    }
  }

  // 浏览量统计（密码通过后）：同 IP 同 token 1 小时内只计 1 次（防刷）
  const ip = clientIp(await headers());
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
    found.share.expires_at
      ? Math.floor(found.share.expires_at.getTime() / 1000)
      : undefined,
  );

  return (
    <main className="report-viewer-shell">
      {/* 系统级报告头：与登录态查看页（/report/[slug]）完全一致的 1280px 头部，
          右侧信息与返回按钮同处 40px 高的垂直带（上下居中对齐同一水平线）。
          系统头随报告正文一起滚出屏幕，报告 iframe 始终保持真实视口。 */}
      <header className="rpt-sys-head">
        <h1 className="rpt-sys-title">{found.reportTitle}</h1>
        <div className="flex h-[40px] shrink-0 items-center">
          <span className="text-[13px] text-[#6e6e73]">
            分享页面 · 来自 SURGE 工作汇报系统
          </span>
        </div>
      </header>
      {/*
        sandbox 允许脚本、下载和用户触发的新标签页，但不带 allow-same-origin：
        报告脚本可执行（图表正常渲染），但运行于 opaque origin——
        读不到 cookie/storage、fetch 不带凭证、无法触碰父页 DOM。
        文档响应另带 CSP（connect-src 'none' 等）作为第二道防线。
      */}
      {/* capability 到期时间 clamp 到分享自身截止时间：分享 18:00 到期时，
          17:59 签出的 capability 不会活过 18:00 */}
      <ReportFrame
        src={reportDocumentUrl(capability)}
        title={found.reportTitle}
        bridgeToken={reportBridgeToken(capability)}
      />
    </main>
  );
}
