"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const COPY_FEEDBACK_MS = 2_000;
const CLIPBOARD_TIMEOUT_MS = 800;

type CopySource = string | (() => string);

type CopyFeedbackProps = {
  text: CopySource;
  label: string;
  copiedLabel?: string;
  disabled?: boolean;
  className?: string;
  onCopyError?: () => void;
};

async function writeClipboardText(value: string): Promise<void> {
  try {
    if (!navigator.clipboard || !window.isSecureContext) {
      throw new Error("clipboard API unavailable");
    }
    let timeoutId: number | null = null;
    try {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error("clipboard write timed out")),
            CLIPBOARD_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
    return;
  } catch {
    const activeElement = document.activeElement;
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (activeElement instanceof HTMLElement) {
      activeElement.focus({ preventScroll: true });
    }
    if (!copied) throw new Error("clipboard fallback failed");
  }
}

function useCopyFeedback({
  text,
  onCopyError,
}: Pick<CopyFeedbackProps, "text" | "onCopyError">) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await writeClipboardText(typeof text === "function" ? text() : text);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch {
      setCopied(false);
      onCopyError?.();
    }
  }, [onCopyError, text]);

  return { copied, copy };
}

/** 胶囊复制按钮：成功后尺寸不变，统一显示绿色“已复制”2 秒。 */
export function CopyPillButton({
  text,
  label,
  copiedLabel = "已复制",
  disabled = false,
  className = "",
  onCopyError,
}: CopyFeedbackProps) {
  const { copied, copy } = useCopyFeedback({ text, onCopyError });
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void copy()}
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      data-copy-variant="pill"
      data-copy-state={copied ? "copied" : "idle"}
      className={className}
      style={
        copied
          ? {
              backgroundColor: "var(--success)",
              borderColor: "var(--success)",
              color: "var(--text-on-fill)",
            }
          : undefined
      }
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

/** 行内复制图标：默认灰、悬停蓝，成功后统一变为绿色勾 2 秒。 */
export function CopyIconButton({
  text,
  label,
  copiedLabel = "已复制",
  disabled = false,
  className = "",
  onCopyError,
  showTooltip = true,
}: CopyFeedbackProps & { showTooltip?: boolean }) {
  const { copied, copy } = useCopyFeedback({ text, onCopyError });
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void copy()}
      aria-label={copied ? copiedLabel : label}
      title={showTooltip ? (copied ? copiedLabel : label) : undefined}
      data-copy-variant="icon"
      data-copy-state={copied ? "copied" : "idle"}
      className={`ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center text-[var(--icon-muted)] transition-colors hover:text-[var(--accent)] focus-visible:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      style={copied ? { color: "var(--success)" } : undefined}
    >
      {/* 两个图标必须同尺寸：按钮是 inline-flex（默认 baseline 对齐），内联元素的基线
          取自身内容底边，图标高度一变，外层文字行高就会跟着变 0.5px，导致整行文字与
          下方元素上下跳动。对号放大到 15px 并等比减细描边（2.2 ≈ 原 14px/2.4 的视觉粗细）。 */}
      {copied ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[15px] w-[15px]"
          aria-hidden="true"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[15px] w-[15px]"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}
