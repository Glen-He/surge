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
          shareClipboardText(`${location.origin}/share/${token}`, passcode)
        }
        label="复制链接"
        disabled={!active}
        className="inline-flex h-8 w-[96px] items-center justify-center rounded-full bg-[var(--control-bg)] text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--control-hover)] disabled:text-[var(--text-disabled)] disabled:opacity-60"
      />
      {active && (
        <button
          type="button"
          onClick={revoke}
          disabled={revoking}
          className="inline-flex h-8 w-[96px] items-center justify-center rounded-full bg-[var(--danger-soft)] text-[12px] font-medium text-[var(--danger-text)] transition-colors hover:bg-[var(--danger-soft)] disabled:opacity-40"
        >
          {revoking ? "撤销中…" : "撤销"}
        </button>
      )}
    </span>
  );
}
