"use client";

const TRACK_CLASS =
  "relative block h-[22px] w-[38px] shrink-0 rounded-full transition-[background-color,box-shadow]";

export function ToggleTrack({
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
        checked ? "bg-[#34c759]" : "bg-[#d1d1d6]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </span>
  );
}

/** 与分享面板一致的紧凑开关。 */
export function ToggleSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex h-[22px] w-[38px] shrink-0 rounded-full border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <ToggleTrack
        checked={checked}
        focusClassName="group-focus-visible:ring-2 group-focus-visible:ring-[#34c759]/25 group-focus-visible:ring-offset-2"
      />
    </button>
  );
}
