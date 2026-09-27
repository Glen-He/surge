"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/features/auth/auth-client";

const GUEST_DOMAIN = "demo.surge";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("请输入邮箱");
      return;
    }

    setLoading(true);
    try {
      // 无论邮箱是否存在都返回成功（防止枚举用户）
      await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset",
      });
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <main className="flex min-h-svh flex-col bg-[var(--surface)] px-6 text-[var(--text-primary)] antialiased">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm py-16 text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-sunken)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7 text-[var(--text-primary)]">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </div>
            <h1 className="type-page-title tracking-tight">检查你的邮箱</h1>
            {email.toLowerCase().endsWith("@" + GUEST_DOMAIN) ? (
              <p className="mt-2 type-body text-[var(--text-secondary)]">
                检测到 <span className="font-medium text-[var(--text-primary)]">游客模式</span>，无需接收邮件：
                <br />
                页面顶部会以 <span className="font-medium text-[var(--accent-text)]">弹窗</span> 形式直接显示“游客验证码”。
              </p>
            ) : (
              <p className="mt-2 type-body text-[var(--text-secondary)]">
                如果 <span className="font-medium text-[var(--text-primary)]">{email}</span>{" "}
                已注册，你将收到一封重置密码的邮件（1 小时内有效）。
                <br />
                没收到？请检查垃圾邮件。
              </p>
            )}
            <Link
              href="/"
              className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--text-primary)] type-control text-[var(--text-on-fill)] transition-opacity hover:opacity-80"
            >
              返回登录
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col bg-[var(--surface)] px-6 text-[var(--text-primary)] antialiased">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm py-16">
          <h1 className="text-center type-page-title tracking-tight">
            忘记密码
          </h1>
          <p className="mt-2 text-center type-body text-[var(--text-secondary)]">
            输入你的邮箱，我们会发送重置链接
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-[40px] flex flex-col gap-[30px]">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--icon-muted)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </span>
              <input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                autoComplete="email"
                className="h-12 w-full rounded-[var(--radius-md)] border border-transparent bg-[var(--surface-sunken)] pl-11 pr-4 type-input text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </div>

            <div className="relative">
              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-full bg-[var(--text-primary)] type-control text-[var(--text-on-fill)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "发送中…" : "发送重置链接"}
              </button>
              <p role="status" className="mt-1.5 h-[var(--line-height-caption)] overflow-hidden type-caption text-[var(--danger-text)]">
                {error}
              </p>
            </div>
          </form>

          <p className="mt-6 text-center type-body">
            <Link href="/" className="text-[var(--accent-text)] hover:underline">
              返回登录
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
