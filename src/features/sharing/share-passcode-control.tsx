"use client";

import { ToggleSwitch } from "@/shared/ui/toggle-switch";

export function SharePasscodeControl({
  enabled,
  onChange,
  disabled = false,
  labelClassName = "mb-2 block type-label",
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  /** 标签样式随容器语境调整：复用 type-label，仅按相邻字段调整间距与颜色 */
  labelClassName?: string;
}) {
  const stateText = enabled ? "自动生成 4 位提取码" : "无需提取码";
  return (
    <div>
      <span className={labelClassName}>访问保护</span>
      {/* 方框本身不是开关：只有右侧小开关（含四周 6px 余量）可点、是小手，行内文字与空白保持箭头 */}
      <div
        data-testid="share-passcode-control"
        className="flex h-[40px] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-control)] bg-[var(--surface)] px-3"
      >
        <span className="min-w-0 truncate type-input text-[var(--text-primary)]">{stateText}</span>
        <ToggleSwitch
          checked={enabled}
          disabled={disabled}
          label={stateText}
          testId="share-passcode-toggle-track"
          onChange={onChange}
        />
      </div>
    </div>
  );
}
