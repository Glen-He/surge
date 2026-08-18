"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";

// 分享链接视图模型
interface ShareView {
  id: string;
  token: string;
  hasPassword: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function statusOf(s: ShareView): { label: string; cls: string } {
  if (s.revokedAt) return { label: "已撤销", cls: "bg-[#f2f2f7] text-[#86868b]" };
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
    return { label: "已过期", cls: "bg-[#f2f2f7] text-[#86868b]" };
  }
  return { label: "生效中", cls: "bg-[#e9fbe9] text-[#166534]" };
}

// 单报告分享链接上限：撤销（物理删除）后可释放名额重新创建
const MAX_SHARES = 5;

// 单报告分享管理弹窗：创建链接（可选密码/有效期）+ 链接列表（复制/撤销）
export function ShareModal({
  open,
  onClose,
  slug,
  title,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  title: string;
}) {
  const [shares, setShares] = useState<ShareView[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [days, setDays] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // 列表滚动容器：创建新链接后回到顶部，确保置顶的新链接可见
  const listRef = useRef<HTMLDivElement>(null);
  // 达到上限：按钮禁用，提示行显示中性说明（非红色错误）
  const limitReached = shares.length >= MAX_SHARES;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/${slug}/shares`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.shares) setShares(data.shares);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${slug}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: password.trim() || null,
          expiresInDays: days,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "创建失败，请重试");
        return;
      }
      setPassword("");
      setDays(0);
      // 乐观更新：直接把新链接前插（置顶），不走 refresh ——
      // refresh 会把列表闪成“加载中”再变回来，正是弹窗内跳动的根源
      if (data?.share) {
        setShares((prev) => [data.share as ShareView, ...prev]);
        if (listRef.current) listRef.current.scrollTop = 0;
      } else {
        await refresh();
      }
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    try {
      const res = await fetch(`/api/shares/${id}`, { method: "DELETE" });
      // 同样乐观更新：本地直接移除，不闪“加载中”
      if (res.ok) setShares((prev) => prev.filter((s) => s.id !== id));
      else await refresh();
    } finally {
      setRevokingId(null);
    }
  }

  async function copyLink(s: ShareView) {
    const url = `${location.origin}/s/${s.token}`;
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
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <Modal open={open} onClose={onClose} title={`分享 · ${title}`} plainHeader>
      <div className="space-y-5">
        {/* 创建区 */}
        <div className="rounded-[14px] border border-black/8 bg-[#f9f9fb] p-4">
          <p className="text-[13px] font-semibold text-[#1d1d1f]">创建分享链接</p>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px] text-[#6e6e73]">访问密码（可选）</label>
              <input
                type="text"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                placeholder="留空则任何人可查看"
                className="h-[38px] w-full rounded-[10px] border border-black/12 bg-white px-3 text-[14px] text-[#1d1d1f] outline-none transition-colors focus:border-[#007aff]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-[#6e6e73]">有效期</label>
              <div className="relative">
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="h-[38px] w-full appearance-none rounded-[10px] border border-black/12 bg-white pl-3 pr-9 text-[14px] text-[#1d1d1f] outline-none transition-colors focus:border-[#007aff]"
                >
                  <option value={0}>永久有效</option>
                  <option value={1}>1 天</option>
                  <option value={7}>7 天</option>
                  <option value={30}>30 天</option>
                </select>
                {/* 自定义下拉箭头：原生箭头贴边太远，内收 12px */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[#86868b]"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </div>
          </div>
          {/* 提示行固定占位 18px：错误（红）/ 达到上限说明（灰）都不改变弹窗高度 */}
          <p
            className={`mt-2 h-[18px] text-[13px] leading-[18px] ${
              limitReached && !error ? "text-[#86868b]" : "text-[#e0301e]"
            }`}
          >
            {error ||
              (limitReached
                ? `最多 ${MAX_SHARES} 条链接，撤销旧链接后可再次创建`
                : "")}
          </p>
          <div className="mt-3 flex justify-end">
            {/* min-w：文字在“生成链接/创建中…”切换时按钮宽度不变 */}
            <button
              type="button"
              onClick={create}
              disabled={creating || limitReached}
              className="inline-flex h-[38px] min-w-[104px] items-center justify-center rounded-full bg-[#007aff] px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              {creating ? "创建中…" : "生成链接"}
            </button>
          </div>
        </div>

        {/* 列表区：固定高度 = 2.5 行链接（50×2 + 间距 8×2 + 25）。
            无论 loading / 空 / 1 条 / 2 条 / 更多，高度恒定 ——
            超过 2 条时第 3 条自然露出上半截，用户一眼知道往下还有内容（滚动暗示），
            因此隐藏原生滚动条：既不难看，也不占宽度，列表卡片与上方创建区完全对齐。
            滚轮 / 触控板 / 触摸滑动照常可用 */}
        <div>
          <p className="mb-2 text-[13px] font-semibold text-[#1d1d1f]">
            已有链接 {shares.length > 0 && `（${shares.length}）`}
          </p>
          <div
            ref={listRef}
            className="h-[141px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {loading ? (
              <div className="flex h-full items-center justify-center rounded-[12px] border border-dashed border-black/10 text-[13px] text-[#86868b]">
                加载中…
              </div>
            ) : shares.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-[12px] border border-dashed border-black/10 text-[13px] text-[#86868b]">
                还没有分享链接，先生成一个
              </div>
            ) : (
              <ul className="space-y-2">
              {shares.map((s) => {
                const st = statusOf(s);
                const active = st.label === "生效中";
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[12px] border border-black/8 bg-white px-3.5 py-2.5"
                  >
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                    <span className="text-[12px] text-[#6e6e73]">
                      {s.hasPassword ? "🔐 密码" : "公开"}
                      {" · "}
                      {s.expiresAt ? `至 ${fmtDate(s.expiresAt)}` : "永久"}
                      {" · "}
                      {s.viewCount} 次浏览
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {/* 两按钮统一 min-w + 居中：文字在“复制链接/已复制”“撤销/撤销中…”间切换时宽度不变 */}
                      <button
                        type="button"
                        onClick={() => copyLink(s)}
                        disabled={!active}
                        className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-black/12 text-[11.5px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#ededf2] disabled:opacity-40"
                      >
                        {copiedId === s.id ? "已复制" : "复制链接"}
                      </button>
                      {active && (
                        <button
                          type="button"
                          onClick={() => revoke(s.id)}
                          disabled={revokingId === s.id}
                          className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[rgba(224,48,30,0.35)] text-[11.5px] font-medium text-[#c0261c] transition-colors hover:bg-[#fef2f2] disabled:opacity-40"
                        >
                          {revokingId === s.id ? "撤销中…" : "撤销"}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
