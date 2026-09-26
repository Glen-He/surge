import Link from "next/link";
import { redirect } from "next/navigation";
import { boardReportShareUrl } from "./board-report-url";
import { cookies } from "next/headers";
import { ReportFrame } from "@/features/reports/viewer/report-frame";
import { SharePasswordGate } from "@/features/sharing/share-password-gate";
import { boardUnlockCookieName, findPublicBoardReport, verifyBoardUnlockProof } from "@/features/sharing/public-share-board";
import { issueCapability, reportBridgeToken } from "@/features/reports/report-capability";
import { reportDocumentUrl } from "@/features/reports/serving/report-origin";
import { getOptionalSession } from "@/features/session/session";

/** 面板条目的统一授权与展示入口，网页落地页同样受面板策略约束。 */
export async function BoardReportView({ token, itemId, landing = false }: {
  token: string;
  itemId: string;
  landing?: boolean;
}) {
  const found = await findPublicBoardReport(token, itemId);
  if (!found) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--page-bg)] px-6">
        <div className="w-full max-w-[400px] rounded-[20px] bg-[var(--surface)] p-8 text-center shadow-[0_2px_14px_rgba(0,0,0,0.05)]">
          <h1 className="text-[17px] font-semibold">该汇报已不在分享面板中</h1>
          <Link href={`/board/${token}`} className="mt-5 inline-flex text-[14px] font-semibold text-[var(--accent-text)]">返回分享面板</Link>
        </div>
      </main>
    );
  }
  const session = await getOptionalSession();
  const isOwner = session?.user.id === found.boardOwnerId;
  if (found.boardPasswordHash && !isOwner) {
    const proof = (await cookies()).get(boardUnlockCookieName(token))?.value;
    if (!verifyBoardUnlockProof(token, found.boardAccessEpoch, proof)) {
      return (
        <SharePasswordGate
          token={token}
          title={found.boardTitle}
          target="board"
        />
      );
    }
  }
  if (found.displayMode === "bare" && !landing) {
    redirect(boardReportShareUrl(token, itemId));
  }
  const capability = issueCapability(
    found.reportId,
    found.revisionId,
    found.capabilityEpoch,
    found.boardExpiresAt
      ? Math.floor(found.boardExpiresAt.getTime() / 1000)
      : undefined,
  );
  return (
    <main className="report-viewer-shell">
      {found.displayMode === "frame" && <header className="rpt-sys-head">
        <h1 className="rpt-sys-title">{found.reportTitle}</h1>
        <Link href={`/board/${token}`} className="rpt-sys-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          返回
        </Link>
      </header>}
      <ReportFrame
        displayMode={found.displayMode}
        src={reportDocumentUrl(capability)}
        title={found.reportTitle}
        bridgeToken={reportBridgeToken(capability)}
      />
    </main>
  );
}
