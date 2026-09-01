"use client";

import { useEffect, useRef, useState } from "react";
import { CopyIconButton } from "@/components/copy-feedback-button";
import { TopNotice } from "@/components/top-notice";
import {
  subscribeGuestOtp,
  type GuestOtpState,
} from "@/lib/guest-otp-store";

/**
 * 游客验证码通知 —— 顶部居中胶囊 Toast。
 *
 * 单一职责：本组件只订阅 store 并渲染（含复制交互）。
 * 显示 / 5s 自动消失的生命周期完全由 store 管（单一事实来源）。
 */
export function GuestOtpModal() {
  const [state, setState] = useState<GuestOtpState | null>(null);
  const [mounted, setMounted] = useState(false);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeGuestOtp((s) => {
      if (unmountTimer.current) {
        clearTimeout(unmountTimer.current);
        unmountTimer.current = null;
      }
      if (s) {
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

  return (
    <TopNotice
      mounted={mounted}
      interactive
      className="top-notice-card-otp"
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
            游客验证码
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
          <CopyIconButton
            text={code}
            label="复制验证码"
            copiedLabel="验证码已复制"
          />
      </div>
    </TopNotice>
  );
}
