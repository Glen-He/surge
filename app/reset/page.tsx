"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { toChineseError } from "@/lib/auth-errors";
import {
  PASSWORD_RULE_TEXT,
  passwordPolicyError,
} from "@/lib/password-policy";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("链接无效或已过期，请重新发起重置");
      return;
    }
    const pwdError = passwordPolicyError(password);
    if (pwdError) {
      setError(pwdError);
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);
    try {
      const { error } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (error) {
        setError(toChineseError(error, "重置失败，链接可能已过期"));
        return;
      }
      // 重置成功，回到登录页
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-white px-6 text-zinc-900 antialiased">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm py-16">
          <h1 className="text-center text-2xl font-semibold tracking-tight">
            设置新密码
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-500">
            请输入你的新密码
          </p>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-[40px] flex flex-col gap-[30px]"
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              </span>
              <input
                type={showPassword ? "text" : "password"}
                placeholder={`新密码（${PASSWORD_RULE_TEXT}）`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="h-12 w-full rounded-xl border border-transparent bg-zinc-100 pl-11 pr-12 text-[15px] text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-[#0071e3] focus:bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-600"
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                    <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c5.5 0 9 7 9 7a17 17 0 0 1-2.6 3.2M6.6 6.6A17 17 0 0 0 3 12s3.5 7 9 7a9.7 9.7 0 0 0 4-.9" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              </span>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="确认新密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="h-12 w-full rounded-xl border border-transparent bg-zinc-100 pl-11 pr-4 text-[15px] text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-[#0071e3] focus:bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-[10px] h-12 w-full rounded-full bg-zinc-900 text-[15px] font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "提交中…" : "重置密码"}
            </button>

            {error && (
              <p className="text-center text-xs text-red-500">{error}</p>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
