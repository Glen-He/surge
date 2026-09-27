"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyIconButton } from "@/shared/ui/copy-feedback-button";
import { ShareSettingsModal } from "@/features/sharing/share-settings-modal";
import { shareClipboardText } from "@/features/sharing/share-copy";

// 分享管理页行操作：设置（有效期/提取码/暂停 + 更换链接）、复制、撤销共用忙碌状态和常驻错误槽。
export function ShareRowActions({
  shareId,
  token,
  passcode,
  active,
  disabled,
  expiresAt,
}: {
  shareId: string;
  token: string;
  passcode: string | null;
  active: boolean;
  disabled: boolean;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 更换链接后的新 token 先本地生效；服务端刷新后 props.token 变成新值，覆盖自动失效
  const [rotated, setRotated] = useState<{ previous: string; token: string } | null>(null);
  const currentToken = rotated?.previous === token ? rotated.token : token;

  async function revoke() {
    if (revoking) return;
    setRevoking(true);
    setError("");
    try {
      const response = await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) { setError(data?.error ?? "操作失败，请重试"); return; }
      router.refresh();
    } catch {
      setError("操作失败，请重试");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="relative flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label="分享设置"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--icon-muted)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--accent-text)]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
          <path d="M4 7h8m4 0h4M4 17h4m4 0h8" />
          <circle cx="14" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      </button>
      <CopyIconButton
        text={() =>
          shareClipboardText(`${location.origin}/share/${currentToken}`, passcode)
        }
        label="复制链接"
        disabled={!active || disabled || revoking}
        onCopyError={() => setError("复制失败，请重试")}
        showTooltip={false}
        className="!ml-0 !h-6 !w-6 rounded-full hover:bg-[var(--control-hover)]"
      />
      <button
        type="button"
        onClick={revoke}
        disabled={revoking}
        aria-label={revoking ? "正在撤销分享链接" : "撤销分享链接"}
        aria-busy={revoking}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--icon-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)] disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      {/* 报错固定出现在操作图标下方，列表条目间距留出位置且不改变卡片高度。 */}
      <p role="status" className="absolute right-0 top-full h-[var(--line-height-caption)] truncate type-caption text-[var(--danger-text)]">{error}</p>

      {settingsOpen && (
        <ShareSettingsModal
          open
          share={{ id: shareId, expiresAt, passcode, disabled }}
          onClose={() => setSettingsOpen(false)}
          onTokenRotated={(next) => {
            setRotated({ previous: token, token: next });
            router.refresh();
          }}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
