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
      <main className="flex min-h-svh flex-col bg-white px-6 text-zinc-900 antialiased">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm py-16 text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7 text-zinc-700">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">检查你的邮箱</h1>
            {email.toLowerCase().endsWith("@" + GUEST_DOMAIN) ? (
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                检测到 <span className="font-medium text-zinc-700">游客模式</span>，无需接收邮件：
                <br />
                页面顶部会以 <span className="font-medium text-[#0066CC]">弹窗</span> 形式直接显示“游客验证码”。
              </p>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                如果 <span className="font-medium text-zinc-700">{email}</span>{" "}
                已注册，你将收到一封重置密码的邮件（1 小时内有效）。
                <br />
                没收到？请检查垃圾邮件。
              </p>
            )}
            <Link
              href="/"
              className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-full bg-zinc-900 text-[15px] font-medium text-white transition-opacity hover:opacity-80"
            >
              返回登录
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col bg-white px-6 text-zinc-900 antialiased">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm py-16">
          <h1 className="text-center text-2xl font-semibold tracking-tight">
            忘记密码
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-500">
            输入你的邮箱，我们会发送重置链接
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-[40px] flex flex-col gap-[30px]">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
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
                className="h-12 w-full rounded-xl border border-transparent bg-zinc-100 pl-11 pr-4 text-[15px] text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-[#0071e3] focus:bg-white"
              />
            </div>

            <div className="relative">
              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-full bg-zinc-900 text-[15px] font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "发送中…" : "发送重置链接"}
              </button>
              {error && (
                <p className="absolute left-0 top-full mt-1.5 text-xs text-red-500">
                  {error}
                </p>
              )}
            </div>
          </form>

          <p className="mt-6 text-center text-sm">
            <Link href="/" className="text-[#0066CC] hover:underline">
              返回登录
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
