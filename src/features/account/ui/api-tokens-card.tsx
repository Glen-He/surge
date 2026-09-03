"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CardHead } from "@/shared/ui/card-head";
import { CopyIconButton } from "@/shared/ui/copy-feedback-button";

// API 令牌卡：单令牌密钥面板
// 无令牌 → 引导创建；有令牌 → 打码显示 + 眼睛切换 + 复制图标 + 更换 + 撤销
// 使用方法在 /account/api-usage（信息按钮跳转）
// 卡片高度与其他账号卡严格一致（280px）：内容区 max-h 83px

type TokenInfo = {
  id: string;
  token: string | null;
};

const ICON_KEY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <circle cx="8" cy="14" r="4" />
    <path d="m11 11 8-8M16 4l3 3M13 7l3 3" />
  </svg>
);

const ICON_INFO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px]">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" strokeLinecap="round" />
    <circle cx="12" cy="7.8" r="0.4" fill="currentColor" />
  </svg>
);

const ICON_EYE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ICON_EYE_OFF = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.3 3.2M6.6 6.6C3.7 8.6 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.8-.8" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

export function ApiTokensCard({ isGuest }: { isGuest: boolean }) {
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  // 常驻错误槽：报错出现/消失零位移
  const [error, setError] = useState("");

  useEffect(() => {
    if (isGuest) return;
    fetch("/api/account/tokens")
      .then((r) => r.json())
      .then((d) => {
        setToken(d.token ?? null);
        if (d.error) setError(d.error);
      })
      .catch(() => setError("令牌加载失败，请刷新后重试"))
      .finally(() => setLoaded(true));
  }, [isGuest]);

  async function mutate(method: "POST" | "PATCH") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/tokens", { method });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "操作失败，请重试");
        return;
      }
      setToken(data.token);
      setRevealed(true);
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (busy || !token) return;
    setBusy(true);
    setError("");
    // 乐观清除
    const prev = token;
    setToken(null);
    setRevealed(false);
    try {
      const res = await fetch("/api/account/tokens", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setToken(prev); // 回滚
        setError(data?.error ?? "撤销失败，请重试");
      }
    } catch {
      setToken(prev);
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
    }
  }

  const masked = "sgk_" + "•".repeat(32);

  return (
    <section className="account-card">
      <CardHead
        icon={ICON_KEY}
        title="API 令牌"
        desc="在脚本或 AI 工具中直接上传汇报"
        extra={
          !isGuest ? (
            <Link
              href="/account/api-usage"
              aria-label="API 使用说明"
              className="mt-[1px] shrink-0 text-[#86868b] transition-colors hover:text-[#0071e3]"
            >
              {ICON_INFO}
            </Link>
          ) : undefined
        }
      />
      {/* 内容区固定高度上限（280 卡高含边框 − padding56 − 头部48 − 间距40 − 操作区51 = 83px） */}
      <div className="card-main shifted max-h-[83px] overflow-y-auto">
        {isGuest ? (
          <p className="text-[15px] leading-[1.5] text-[#6e6e73]">
            游客模式不支持 API 令牌，注册正式账号后可用
          </p>
        ) : !loaded ? (
          <p className="text-[15px] leading-[1.5] text-[#86868b]">加载中…</p>
        ) : token ? (
          <div>
            <div className="flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] leading-[1.5] text-[#1d1d1f]">
                {token.token ? (revealed ? token.token : masked) : "令牌不可读取"}
              </code>
              {token.token && (
                <>
                  <button
                    type="button"
                    aria-label={revealed ? "隐藏令牌" : "显示令牌"}
                    onClick={() => setRevealed((v) => !v)}
                    className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[#86868b] transition-colors hover:text-[#0071e3]"
                  >
                    {revealed ? ICON_EYE_OFF : ICON_EYE}
                  </button>
                  <CopyIconButton
                    key={token.token}
                    text={token.token}
                    label="复制令牌"
                    copiedLabel="令牌已复制"
                    onCopyError={() => setError("复制失败，请稍后重试")}
                  />
                </>
              )}
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.4] text-[#86868b]">
              {token.token
                ? "更换或撤销后旧值立即失效"
                : "更换后会生成新的可查看令牌"}
            </p>
          </div>
        ) : (
          <p className="text-[15px] leading-[1.5] text-[#6e6e73]">
            还没有令牌，创建后可在代码中直接上传汇报
          </p>
        )}
        {/* 常驻错误槽：高度固定，报错出现/消失零位移 */}
        <p className="mt-3 min-h-[1.375rem] text-[13px] leading-[1.5] text-[#ff3b30]">
          {error || null}
        </p>
      </div>
      <div className="card-action-wrap">
        <div className="card-action gap-6">
          {token ? (
            <>
              <button
                type="button"
                onClick={() => void handleRevoke()}
                disabled={busy}
                // .btn-action 定义在非 @layer 规则里，红色必须内联覆盖（同 .btn-secondary 的坑）
                style={{ color: "#ff3b30" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#d70015")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#ff3b30")}
                className="btn-action disabled:cursor-not-allowed disabled:opacity-40"
              >
                撤销
              </button>
              <button
                type="button"
                onClick={() => void mutate("PATCH")}
                disabled={busy}
                // pr = 箭头占位（14px 图标 + 2px 间距）：.btn-action 的 padding 在非 layer 规则里，
                // Tailwind 工具类会被覆盖，必须内联（同 .btn-secondary 的坑）
                style={{ paddingRight: "16px" }}
                className="btn-action disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "处理中…" : "更换"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isGuest || busy}
              onClick={() => void mutate("POST")}
              // 同上：箭头占位，保证「新建令牌」四字与「修改密码」四字位置一致
              style={{ paddingRight: "16px" }}
              className="btn-action disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "创建中…" : "新建令牌"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
