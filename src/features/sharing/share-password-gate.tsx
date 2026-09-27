"use client";

import { useCallback, useRef, useState } from "react";
import { useAutoSharePasscode } from "@/features/sharing/use-auto-share-passcode";

const TARGETS = {
  report: {
    endpoint: "share",
    action: "查看报告",
    surface:
      "border border-[var(--border)] shadow-[0_2px_8px_rgba(0,0,0,0.04)]",
  },
  board: {
    endpoint: "share-board",
    action: "进入分享面板",
    surface: "shadow-[0_2px_14px_rgba(0,0,0,0.05)]",
  },
} as const;

type SharePasswordTarget = keyof typeof TARGETS;

// 分享密码门：验证通过后刷新当前页面，让服务端读取新签发的解锁 Cookie。
export function SharePasswordGate({
  token,
  title,
  target,
}: {
  token: string;
  title: string;
  target: SharePasswordTarget;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const config = TARGETS[target];

  const submit = useCallback(async (providedPassword?: string) => {
    const nextPassword = providedPassword ?? password;
    if (!nextPassword || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/${config.endpoint}/${token}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nextPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "提取码不正确");
        return;
      }
      window.location.replace(`${window.location.pathname}${window.location.search}`);
    } catch {
      setError("网络异常，请重试");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [config.endpoint, password, token]);

  useAutoSharePasscode(true, (passcode) => {
    setPassword(passcode);
    void submit(passcode);
  });

  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--page-bg)] px-6">
      <div
        className={`w-full max-w-[400px] rounded-[var(--radius-xl)] bg-[var(--surface)] p-8 ${config.surface}`}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" className="h-6 w-6">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h1 className="text-center type-section-title text-[var(--text-primary)]">
          {title}
        </h1>
        <p className="mt-1.5 text-center type-caption text-[var(--text-secondary)]">
          请输入分享者提供的 4 位提取码
        </p>
        <input
          type="text"
          value={password}
          onChange={(e) => {
            setPassword(
              e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4),
            );
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="4 位提取码"
          maxLength={4}
          autoCapitalize="characters"
          autoComplete="off"
          className="mt-5 h-[44px] w-full rounded-full border border-[var(--border-control)] bg-[var(--surface)] px-4 text-center type-input tracking-[0.24em] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
        />
        {/* 错误行固定占位：避免密码错误提示出现时卡片高度跳变 */}
        <p className="mt-2 h-[var(--line-height-caption)] text-center type-caption text-[var(--danger-text)]">{error}</p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading || !password}
          className="mt-4 h-[44px] w-full rounded-full bg-[var(--accent)] type-control text-[var(--text-on-fill)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          {loading ? "验证中…" : config.action}
        </button>
        <p className="mt-5 text-center type-caption text-[var(--text-secondary)]">
          来自 SURGE 工作汇报系统的分享
        </p>
      </div>
    </main>
  );
}
