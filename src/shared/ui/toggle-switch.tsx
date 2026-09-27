"use client";

const TRACK_CLASS =
  "relative block h-[22px] w-[38px] shrink-0 rounded-full transition-[background-color,box-shadow]";

/** 纯展示的开关轨道；点击区与无障碍语义统一由外层 `ToggleSwitch` 提供。 */
function ToggleTrack({
  checked,
  focusClassName = "",
  testId,
}: {
  checked: boolean;
  focusClassName?: string;
  testId?: string;
}) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={`${TRACK_CLASS} ${focusClassName} ${
        checked ? "bg-[var(--success)]" : "bg-[var(--control-off)]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-[var(--surface)] shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </span>
  );
}

/**
 * 与分享面板一致的紧凑开关。
 *
 * 可点区域只在开关本身（含四周各 6px 余量，视觉位置不变），**整行不做成开关**：
 * 行内文字与空白保持默认箭头光标，点击不切换。用户明确要求过「不要整行都可点」，
 * 不要再把它改成整行 `<button role="switch">`。
 */
export function ToggleSwitch({
  checked,
  disabled = false,
  pending = false,
  muted = disabled,
  label,
  testId,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  pending?: boolean;
  muted?: boolean;
  label: string;
  testId?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={pending || undefined}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // 6px padding + 等量负外边距：点击余量变大，滑轨的视觉位置与原来一致
      className={`group -mr-1.5 inline-flex h-[34px] w-[50px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-1.5 disabled:cursor-not-allowed ${
        pending || muted ? "opacity-45" : ""
      }`}
    >
      <ToggleTrack
        checked={checked}
        testId={testId}
        focusClassName="group-focus-visible:ring-2 group-focus-visible:ring-[var(--success)]/25 group-focus-visible:ring-offset-2"
      />
    </button>
  );
}
