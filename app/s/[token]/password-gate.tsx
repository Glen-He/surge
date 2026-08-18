"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 分享密码门：苹果风格居中卡片，验证通过后刷新父页进入 iframe 视图
export function SharePasswordGate({
  token,
  title,
}: {
  token: string;
  title: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (loading || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/share/${token}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "密码不正确");
        return;
      }
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#f5f5f7] px-6">
      <div className="w-full max-w-[400px] rounded-[20px] border border-black/8 bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(88,86,214,0.08)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="#5856d6" strokeWidth="1.8" className="h-6 w-6">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h1 className="text-center text-[17px] font-semibold text-[#1d1d1f]">
          {title}
        </h1>
        <p className="mt-1.5 text-center text-[13px] text-[#6e6e73]">
          该报告已加密，请输入访问密码
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="访问密码"
          autoFocus
          className="mt-5 h-[44px] w-full rounded-full border border-black/12 bg-white px-4 text-center text-[16px] text-[#1d1d1f] outline-none transition-colors focus:border-[#007aff]"
        />
        {/* 错误行固定占位：避免密码错误提示出现时卡片高度跳变 */}
        <p className="mt-2 h-[18px] text-center text-[13px] leading-[18px] text-[#e0301e]">{error}</p>
        <button
          type="button"
          onClick={submit}
          disabled={loading || !password}
          className="mt-4 h-[44px] w-full rounded-full bg-[#007aff] text-[15px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {loading ? "验证中…" : "查看报告"}
        </button>
        <p className="mt-5 text-center text-[12px] text-[#86868b]">
          来自 SURGE 工作汇报系统的分享
        </p>
      </div>
    </main>
  );
}
