"use client";

import { useEffect, useRef, useState } from "react";
import {
  subscribeGuestOtp,
  type GuestOtpState,
} from "@/lib/guest-otp-store";

/**
 * 访客验证码通知 —— 顶部居中胶囊 Toast。
 *
 * 单一职责：本组件只订阅 store 并渲染（含复制交互）。
 * 显示 / 5s 自动消失的生命周期完全由 store 管（单一事实来源）。
 */
export function GuestOtpModal() {
  const [state, setState] = useState<GuestOtpState | null>(null);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeGuestOtp((s) => {
      if (unmountTimer.current) {
        clearTimeout(unmountTimer.current);
        unmountTimer.current = null;
      }
      if (s) {
        setCopied(false);
        setState(s);
        requestAnimationFrame(() => setMounted(true));
      } else {
        // 先播放退场动画，260ms 后卸载 DOM
        setMounted(false);
        unmountTimer.current = setTimeout(() => setState(null), 260);
      }
    });
    return () => {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      unsubscribe();
    };
  }, []);

  if (!state) return null;

  const code = state.code.padStart(6, "0");

  async function onCopy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      aria-live="polite"
      className={[
        "pointer-events-none fixed left-1/2 top-6 z-[120] -translate-x-1/2",
        "transition-all duration-300 ease-out",
        mounted ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0",
      ].join(" ")}
    >
      <div
        className="pointer-events-auto relative"
        style={{
          width: "fit-content",
          minWidth: 260,
          maxWidth: "min(310px, calc(100vw - 48px))",
          height: 56,
          backdropFilter: "saturate(180%) blur(22px)",
          WebkitBackdropFilter: "saturate(180%) blur(22px)",
          background: "rgba(240, 240, 245, 0.95)",
          borderRadius: 28, // 胶囊：高度56 → 半径28，两端完全半圆
          boxShadow:
            "0 10px 30px rgba(0, 0, 0, 0.10), 0 1px 3px rgba(0, 0, 0, 0.05)",
          padding: "0 18px",
        }}
      >
        <div className="flex h-full items-center" style={{ gap: 10 }}>
          {/* 左：20px 蓝色线框锁 */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0071E3"
            strokeWidth={1.8}
            className="h-5 w-5 shrink-0"
            aria-hidden="true"
          >
            <rect x="4" y="11" width="16" height="10" rx="3" />
            <path d="M8 11V8a4 4 0 1 1 8 0v3" />
          </svg>

          {/* 单一行：标题 + 数字 + 复制按钮，全部同一水平线 */}
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1d1d1f",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            访客验证码
          </span>
          <span
            aria-label={`验证码 ${code}`}
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "0.12em",
              color: "#0071E3",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {code}
          </span>
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? "已复制" : "复制验证码"}
            title={copied ? "已复制" : "复制验证码"}
            className="flex shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 active:bg-black/10"
            style={{
              width: 22,
              height: 22,
              color: copied ? "#34c759" : "#86868b",
              marginLeft: 2,
            }}
          >
            {copied ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                className="h-3.5 w-3.5"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="h-3.5 w-3.5"
              >
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
