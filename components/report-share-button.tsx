"use client";

import { useEffect, useState } from "react";
import { ShareModal } from "@/components/share-modal";
import { REPORT_SHARE_REQUEST_EVENT } from "@/lib/report-header";

// 报告页顶部分享胶囊（与返回按钮同一视觉语言）
export function ReportShareButton({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openFromReportHeader = () => setOpen(true);
    window.addEventListener(REPORT_SHARE_REQUEST_EVENT, openFromReportHeader);
    return () =>
      window.removeEventListener(REPORT_SHARE_REQUEST_EVENT, openFromReportHeader);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rpt-sys-back"
        data-report-share-trigger
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        分享
      </button>
      <ShareModal open={open} onClose={() => setOpen(false)} slug={slug} title={title} />
    </>
  );
}
