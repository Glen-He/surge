"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 分享管理页行操作：复制 / 撤销
export function ShareRowActions({
  shareId,
  token,
  active,
}: {
  shareId: string;
  token: string;
  active: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function copy() {
    const url = `${location.origin}/s/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function revoke() {
    if (revoking) return;
    setRevoking(true);
    try {
      await fetch(`/api/shares/${shareId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {/* 与弹窗内按钮同一尺寸规则：统一 min-w + 居中，文字切换时宽度不变 */}
      <button
        type="button"
        onClick={copy}
        disabled={!active}
        className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[rgba(0,0,0,0.1)] text-[12px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#ededf2] disabled:opacity-40"
      >
        {copied ? "已复制" : "复制链接"}
      </button>
      {active && (
        <button
          type="button"
          onClick={revoke}
          disabled={revoking}
          className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[rgba(224,48,30,0.35)] text-[12px] font-medium text-[#c0261c] transition-colors hover:bg-[#fef2f2] disabled:opacity-40"
        >
          {revoking ? "撤销中…" : "撤销"}
        </button>
      )}
    </span>
  );
}
