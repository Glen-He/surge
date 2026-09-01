"use client";

import { ToggleTrack } from "@/components/toggle-switch";

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
      <span className="mb-1 block text-[12px] text-[#6e6e73]">访问保护</span>
      <button
        type="button"
        role="switch"
        data-testid="share-passcode-control"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className="group flex h-[38px] w-full items-center justify-between rounded-[10px] border border-black/12 bg-white px-3 text-left text-[14px] text-[#1d1d1f] outline-none transition-colors hover:bg-[#fafafa] disabled:opacity-50"
      >
        <span>{enabled ? "自动生成 4 位提取码" : "无需提取码"}</span>
        <ToggleTrack
          checked={enabled}
          testId="share-passcode-toggle-track"
          focusClassName="group-focus-visible:ring-2 group-focus-visible:ring-[#34c759]/25 group-focus-visible:ring-offset-2"
        />
      </button>
    </div>
  );
}
