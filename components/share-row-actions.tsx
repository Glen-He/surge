"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyPillButton } from "@/components/copy-feedback-button";
import { shareClipboardText } from "@/lib/share-copy";

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
    <span className="inline-flex items-center gap-1.5">
      {/* 与弹窗内按钮同一尺寸规则：统一 min-w + 居中，文字切换时宽度不变 */}
      <CopyPillButton
        text={() =>
          shareClipboardText(`${location.origin}/s/${token}`, passcode)
        }
        label="复制链接"
        disabled={!active}
        className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[rgba(0,0,0,0.1)] text-[12px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#ededf2] disabled:opacity-40"
      />
      {active && (
        <button
          type="button"
          onClick={revoke}
          disabled={revoking}
          className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[rgba(255,59,48,0.35)] text-[12px] font-medium text-[#ff3b30] transition-colors hover:bg-[rgba(255,59,48,0.06)] disabled:opacity-40"
        >
          {revoking ? "撤销中…" : "撤销"}
        </button>
      )}
    </span>
  );
}
