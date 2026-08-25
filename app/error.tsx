"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#f5f5f7] px-6 py-12">
      <div className="w-full max-w-[420px] rounded-[24px] bg-white p-8 text-center shadow-[0_12px_36px_rgba(0,0,0,0.08)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(255,149,0,0.12)] text-[#c86600]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7" aria-hidden="true">
            <path d="M12 8v5" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
          页面暂时无法加载
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[#6e6e73]">
          数据没有丢失。请重试一次；如果仍然失败，稍后再回来看看。
        </p>
        <button type="button" onClick={reset} className="btn-primary mt-6">
          重新加载
        </button>
      </div>
    </main>
  );
}
