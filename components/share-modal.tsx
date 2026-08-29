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

interface BoardView {
  id: string;
  token: string;
  title: string;
  hasPassword: boolean;
  disabled: boolean;
  viewCount: number;
  itemCount: number;
  included: boolean;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function statusOf(s: ShareView): { label: string; cls: string } {
  if (s.revokedAt) return { label: "已撤销", cls: "bg-[#f2f2f7] text-[#6e6e73]" };
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
    return { label: "已过期", cls: "bg-[#f2f2f7] text-[#6e6e73]" };
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
  if (!open) return null;
  return <ShareDialog onClose={onClose} slug={slug} title={title} />;
}

function ShareDialog({
  onClose,
  slug,
  title,
}: {
  onClose: () => void;
  slug: string;
  title: string;
}) {
  const [tab, setTab] = useState<"boards" | "links">("boards");
  const [shares, setShares] = useState<ShareView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [days, setDays] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardView[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardName, setBoardName] = useState("");
  const [boardError, setBoardError] = useState("");
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [changingBoardId, setChangingBoardId] = useState<string | null>(null);
  const [copiedBoardId, setCopiedBoardId] = useState<string | null>(null);
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
    let active = true;
    void fetch(`/api/reports/${slug}/shares`)
      .then(async (response) => ({
        ok: response.ok,
        data: await response.json().catch(() => null),
      }))
      .then(({ ok, data }) => {
        if (active && ok && data?.shares) setShares(data.shares);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/reports/${slug}/boards`)
      .then(async (response) => ({
        ok: response.ok,
        data: await response.json().catch(() => null),
      }))
      .then(({ ok, data }) => {
        if (active && ok && data?.boards) setBoards(data.boards);
      })
      .finally(() => {
        if (active) setBoardsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

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

  async function writeClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  async function createBoard() {
    const name = boardName.trim();
    if (!name || creatingBoard) return;
    setCreatingBoard(true);
    setBoardError("");
    try {
      const response = await fetch("/api/share-boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, reportSlug: slug }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setBoardError(data?.error ?? "创建失败，请重试");
        return;
      }
      setBoardName("");
      setBoards((current) => [{ ...data.board, included: true }, ...current]);
    } finally {
      setCreatingBoard(false);
    }
  }

  async function toggleBoard(board: BoardView) {
    if (changingBoardId) return;
    setChangingBoardId(board.id);
    setBoardError("");
    const next = !board.included;
    setBoards((current) => current.map((item) =>
      item.id === board.id
        ? { ...item, included: next, itemCount: item.itemCount + (next ? 1 : -1) }
        : item,
    ));
    try {
      const response = await fetch(`/api/reports/${slug}/boards/${board.id}`, {
        method: next ? "PUT" : "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setBoards((current) => current.map((item) =>
          item.id === board.id
            ? { ...item, included: board.included, itemCount: board.itemCount }
            : item,
        ));
        setBoardError(data?.error ?? "更新失败，请重试");
      }
    } finally {
      setChangingBoardId(null);
    }
  }

  async function copyBoard(board: BoardView) {
    await writeClipboard(`${location.origin}/b/${board.token}`);
    setCopiedBoardId(board.id);
    setTimeout(() => setCopiedBoardId(null), 2000);
  }

  return (
    <Modal open onClose={onClose} title={`分享 · ${title}`} plainHeader>
      <div className="mb-5 grid grid-cols-2 rounded-full bg-[#f2f2f7] p-1">
        <button
          type="button"
          onClick={() => setTab("boards")}
          className={`h-[34px] rounded-full text-[13px] font-semibold transition-colors ${
            tab === "boards" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73]"
          }`}
        >
          分享面板
        </button>
        <button
          type="button"
          onClick={() => setTab("links")}
          className={`h-[34px] rounded-full text-[13px] font-semibold transition-colors ${
            tab === "links" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73]"
          }`}
        >
          分享链接
        </button>
      </div>

      {tab === "boards" ? (
        <div className="space-y-5">
          <div className="rounded-[14px] bg-[#f9f9fb] p-4">
            <p className="text-[13px] font-semibold text-[#1d1d1f]">新建面板并加入当前汇报</p>
            <div className="mt-3 flex gap-2.5">
              <input
                type="text"
                value={boardName}
                onChange={(event) => {
                  setBoardName(event.target.value);
                  setBoardError("");
                }}
                onKeyDown={(event) => event.key === "Enter" && void createBoard()}
                maxLength={40}
                placeholder="例如：课题组周会、院领导汇报"
                className="h-[42px] min-w-0 flex-1 rounded-[10px] border border-black/12 bg-white px-3 text-[14px] outline-none focus:border-[#0071e3]"
              />
              <button
                type="button"
                onClick={createBoard}
                disabled={!boardName.trim() || creatingBoard}
                className="btn-primary"
              >
                {creatingBoard ? "创建中…" : "新建面板"}
              </button>
            </div>
            <p className="mt-2 h-[18px] text-[13px] leading-[18px] text-[#ff3b30]">{boardError}</p>
          </div>

          <div>
            <p className="mb-2 text-[13px] font-semibold text-[#1d1d1f]">
              选择要展示当前汇报的面板 {boards.length > 0 && `（${boards.length}）`}
            </p>
            <div className="h-[230px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {boardsLoading ? (
                <div className="flex h-full items-center justify-center rounded-[12px] bg-[#f9f9fb] text-[13px] text-[#6e6e73]">加载中…</div>
              ) : boards.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[12px] bg-[#f9f9fb] text-[13px] text-[#6e6e73]">还没有分享面板，先新建一个</div>
              ) : (
                <ul className="space-y-2">
                  {boards.map((board) => (
                    <li key={board.id} className="flex min-h-[58px] items-center gap-3 rounded-[12px] bg-[#f9f9fb] px-3.5 py-2.5">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={board.included}
                        aria-label={`${board.included ? "从面板移除" : "加入面板"} ${board.title}`}
                        disabled={changingBoardId === board.id}
                        onClick={() => toggleBoard(board)}
                        className={`relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${board.included ? "bg-[#34c759]" : "bg-[#d1d1d6]"}`}
                      >
                        <span className={`absolute top-[2px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${board.included ? "translate-x-0 left-5" : "left-0.5"}`} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-[#1d1d1f]">
                          {board.title}
                          <button
                            type="button"
                            onClick={() => copyBoard(board)}
                            aria-label={`复制 ${board.title} 的链接`}
                            title={copiedBoardId === board.id ? "已复制" : "复制面板链接"}
                            className="relative top-[2px] ml-1 inline-flex h-4 w-4 items-center justify-center text-[#86868b] hover:text-[#1d1d1f] disabled:opacity-40"
                            disabled={board.disabled}
                          >
                            {copiedBoardId === board.id ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-3 w-3"><path d="M20 6 9 17l-5-5" /></svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                            )}
                          </button>
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#6e6e73]">
                          {board.disabled ? "已停用" : board.hasPassword ? "密码保护" : "无需密码"} · {board.itemCount} 份汇报
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
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
                className="h-[38px] w-full rounded-[10px] border border-black/12 bg-white px-3 text-[14px] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-[#6e6e73]">有效期</label>
              <div className="relative">
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="h-[38px] w-full appearance-none rounded-[10px] border border-black/12 bg-white pl-3 pr-9 text-[14px] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
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
              limitReached && !error ? "text-[#6e6e73]" : "text-[#ff3b30]"
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
              className="btn-primary"
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
              <div className="flex h-full items-center justify-center rounded-[12px] border border-dashed border-black/10 text-[13px] text-[#6e6e73]">
                加载中…
              </div>
            ) : shares.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-[12px] border border-dashed border-black/10 text-[13px] text-[#6e6e73]">
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
                        className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[rgba(0,0,0,0.1)] text-[12px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#ededf2] disabled:opacity-40"
                      >
                        {copiedId === s.id ? "已复制" : "复制链接"}
                      </button>
                      {active && (
                        <button
                          type="button"
                          onClick={() => revoke(s.id)}
                          disabled={revokingId === s.id}
                          className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[rgba(255,59,48,0.35)] text-[12px] font-medium text-[#ff3b30] transition-colors hover:bg-[rgba(255,59,48,0.06)] disabled:opacity-40"
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
      )}
    </Modal>
  );
}
