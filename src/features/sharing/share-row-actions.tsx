"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyPillButton } from "@/shared/ui/copy-feedback-button";
import { shareClipboardText } from "@/features/sharing/share-copy";

// 分享管理页行操作：复制 / 撤销
export function ShareRowActions({
  shareId,
  token,
  passcode,
  active,
}: {
  shareId: string;
  token: string;
  passcode: string | null;
  active: boolean;
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState(false);

  async function revoke() {
    if (revoking) return;
    setRevoking(true);
    try {
      await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-3">
      {/* 与分享面板卡片同一尺寸，文字切换时宽度不变。 */}
      <CopyPillButton
        text={() =>
          shareClipboardText(`${location.origin}/s/${token}`, passcode)
        }
        label="复制链接"
        disabled={!active}
        className="inline-flex h-8 w-[96px] items-center justify-center rounded-full bg-[#f2f2f7] text-[12px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#e8e8ed] disabled:text-[#86868b] disabled:opacity-60"
      />
      {active && (
        <button
          type="button"
          onClick={revoke}
          disabled={revoking}
          className="inline-flex h-8 w-[96px] items-center justify-center rounded-full bg-[rgba(255,59,48,0.08)] text-[12px] font-medium text-[#ff3b30] transition-colors hover:bg-[rgba(255,59,48,0.12)] disabled:opacity-40"
        >
          {revoking ? "撤销中…" : "撤销"}
        </button>
      )}
    </span>
  );
}
