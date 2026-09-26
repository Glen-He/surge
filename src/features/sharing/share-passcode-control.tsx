"use client";

import { ToggleTrack } from "@/shared/ui/toggle-switch";

export function SharePasscodeControl({
  enabled,
  onChange,
  disabled = false,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="mb-1 block text-[12px] text-[var(--text-secondary)]">访问保护</span>
      <button
        type="button"
        role="switch"
        data-testid="share-passcode-control"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className="group flex h-[38px] w-full items-center justify-between rounded-[10px] border border-[var(--border-control)] bg-[var(--surface)] px-3 text-left text-[14px] text-[var(--text-primary)] outline-none transition-colors hover:bg-[var(--control-hover)] disabled:opacity-50"
      >
        <span>{enabled ? "自动生成 4 位提取码" : "无需提取码"}</span>
        <ToggleTrack
          checked={enabled}
          testId="share-passcode-toggle-track"
          focusClassName="group-focus-visible:ring-2 group-focus-visible:ring-[var(--success)]/25 group-focus-visible:ring-offset-2"
        />
      </button>
    </div>
  );
}
