"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CopyPillButton } from "@/shared/ui/copy-feedback-button";
import { Modal } from "@/shared/ui/modal/modal";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SharePasscodeControl } from "@/features/sharing/share-passcode-control";
import { SHARE_EXPIRY_OPTIONS } from "@/features/sharing/share-expiry";
import type { ShareExpiryDays } from "@/features/sharing/share-expiry";
import { shareClipboardText } from "@/features/sharing/share-copy";

// 分享链接视图模型
interface ShareView {
  id: string;
  token: string;
  passcode: string | null;
  expiresAt: string | null;
  disabled: boolean;
}

interface BoardView {
  id: string;
  token: string;
  title: string;
  hasPassword: boolean;
  passcode: string | null;
  disabled: boolean;
  included: boolean;
}

function statusOf(s: ShareView): { label: string; cls: string } {
  if (s.disabled) {
    return { label: "已暂停", cls: "bg-[var(--control-bg)] text-[var(--text-secondary)]" };
  }
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
    return { label: "已过期", cls: "bg-[var(--control-bg)] text-[var(--text-secondary)]" };
  }
  return { label: "生效中", cls: "bg-[var(--success-soft)] text-[var(--success-text)]" };
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
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [days, setDays] = useState<ShareExpiryDays>(0);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardView[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardName, setBoardName] = useState("");
  const [boardPasswordProtected, setBoardPasswordProtected] = useState(false);
  const [boardError, setBoardError] = useState("");
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [changingBoardId, setChangingBoardId] = useState<string | null>(null);
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
          passwordProtected,
          expiresInDays: days,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "创建失败，请重试");
        return;
      }
      setPasswordProtected(false);
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

  async function rotate(id: string) {
    if (rotatingId || revokingId) return;
    setRotatingId(id);
    setError("");
    try {
      const response = await fetch(`/api/shares/${id}/rotate-token`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.token) { setError(data?.error ?? "更换失败，请重试"); return; }
      setShares((current) => current.map((share) => share.id === id ? { ...share, token: data.token } : share));
    } catch { setError("更换失败，请重试"); }
    finally { setRotatingId(null); }
  }

  async function revoke(id: string) {
    if (revokingId || rotatingId) return;
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

  async function createBoard() {
    const name = boardName.trim();
    if (!name || creatingBoard) return;
    setCreatingBoard(true);
    setBoardError("");
    try {
      const response = await fetch("/api/share-boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name,
          passwordProtected: boardPasswordProtected,
          reportSlug: slug,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setBoardError(data?.error ?? "创建失败，请重试");
        return;
      }
      setBoardName("");
      setBoardPasswordProtected(false);
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
        ? { ...item, included: next }
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
            ? { ...item, included: board.included }
            : item,
        ));
        setBoardError(data?.error ?? "更新失败，请重试");
      }
    } finally {
      setChangingBoardId(null);
    }
  }

  return (
    <Modal open onClose={onClose} title={`分享 · ${title}`} plainHeader>
      <div
        role="tablist"
        aria-label="分享方式"
        className="relative mb-5 grid h-[42px] grid-cols-2 rounded-full bg-[var(--control-bg)] p-1"
      >
        <span
          aria-hidden
          data-testid="share-tab-indicator"
          className="absolute bottom-1 left-1 top-1 rounded-full bg-[var(--surface)]"
          style={{
            width: "calc((100% - 8px) / 2)",
            transform: tab === "boards" ? "translateX(0)" : "translateX(100%)",
            transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow:
              "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.03)",
          }}
        />
        <button
          type="button"
          role="tab"
          id="share-tab-boards"
          aria-selected={tab === "boards"}
          aria-controls="share-panel-boards"
          onClick={() => setTab("boards")}
          className={`relative z-10 h-[34px] rounded-full type-control transition-colors ${
            tab === "boards" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
          }`}
        >
          分享面板
        </button>
        <button
          type="button"
          role="tab"
          id="share-tab-links"
          aria-selected={tab === "links"}
          aria-controls="share-panel-links"
          onClick={() => setTab("links")}
          className={`relative z-10 h-[34px] rounded-full type-control transition-colors ${
            tab === "links" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
          }`}
        >
          分享链接
        </button>
      </div>

      {/* 两个面板共用固定内容高度；切换时外层弹窗尺寸不变，列表只在内部滚动。 */}
      <div className="h-[404px] max-sm:h-[450px]">
      {tab === "boards" ? (
        <div
          id="share-panel-boards"
          role="tabpanel"
          aria-labelledby="share-tab-boards"
          className="flex h-full flex-col gap-5"
        >
          <div className="shrink-0 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] p-4">
            <p className="type-label text-[var(--text-primary)]">新建面板并加入当前汇报</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label htmlFor="new-share-board-name" className="mb-1 block type-label text-[var(--text-secondary)]">
                  面板名称
                </label>
                <input
                  id="new-share-board-name"
                  type="text"
                  value={boardName}
                  onChange={(event) => {
                    setBoardName(event.target.value);
                    setBoardError("");
                  }}
                  onKeyDown={(event) => event.key === "Enter" && void createBoard()}
                  maxLength={40}
                  placeholder="例如：课题组周会"
                  className="h-[40px] w-full rounded-[var(--radius-md)] border border-[var(--border-control)] bg-[var(--surface)] px-3 type-input text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                />
              </div>
              <SharePasscodeControl
                enabled={boardPasswordProtected}
                onChange={(enabled) => {
                  setBoardPasswordProtected(enabled);
                  setBoardError("");
                }}
                disabled={creatingBoard}
                labelClassName="mb-1 block type-label text-[var(--text-secondary)]"
              />
            </div>
            <p className="mt-2 h-[var(--line-height-caption)] type-caption text-[var(--danger-text)]">{boardError}</p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={createBoard}
                disabled={!boardName.trim() || creatingBoard}
                className="btn-primary min-w-[96px]"
              >
                {creatingBoard ? "创建中…" : "新建面板"}
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <p className="mb-2 type-label text-[var(--text-primary)]">
              已有面板 {boards.length > 0 && `（${boards.length}）`}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {boardsLoading ? (
                <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-control)] type-caption text-[var(--text-secondary)]">加载中…</div>
              ) : boards.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-control)] type-caption text-[var(--text-secondary)]">还没有分享面板，先新建一个</div>
              ) : (
                <ul className="space-y-2">
                  {boards.map((board) => {
                    const boardStatus = board.disabled
                      ? { label: "已停用", cls: "bg-[var(--control-bg)] text-[var(--text-secondary)]" }
                      : board.included
                        ? { label: "已加入", cls: "bg-[var(--success-soft)] text-[var(--success-text)]" }
                        : { label: "未加入", cls: "bg-[var(--control-bg)] text-[var(--text-secondary)]" };
                    return (
                      <li
                        key={board.id}
                        className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5"
                      >
                        <span className={`rounded-full px-2.5 py-0.5 type-badge ${boardStatus.cls}`}>
                          {boardStatus.label}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate type-label text-[var(--text-primary)]">{board.title}</span>
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <CopyPillButton
                            text={() =>
                              shareClipboardText(
                                `${location.origin}/board/${board.token}`,
                                board.passcode,
                              )
                            }
                            label="复制链接"
                            disabled={board.disabled}
                            className="inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border border-[var(--border-control)] type-control-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--control-hover)] disabled:opacity-40"
                          />
                          <button
                            type="button"
                            onClick={() => toggleBoard(board)}
                            disabled={board.disabled || changingBoardId === board.id}
                            className={`inline-flex h-[28px] min-w-[78px] items-center justify-center rounded-full border type-control-sm transition-colors disabled:opacity-40 ${
                              board.included
                                ? "border-[var(--danger-border)] text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"
                                : "border-[var(--accent-border)] text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
                            }`}
                          >
                            {changingBoardId === board.id
                              ? "更新中…"
                              : board.included
                                ? "移出面板"
                                : "加入面板"}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div
        id="share-panel-links"
        role="tabpanel"
        aria-labelledby="share-tab-links"
        className="flex h-full flex-col gap-5"
      >
        {/* 创建区 */}
        <div className="shrink-0 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] p-4">
          <p className="type-label text-[var(--text-primary)]">创建分享链接</p>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="share-link-expiry" className="mb-1 block type-label text-[var(--text-secondary)]">
                有效期
              </label>
              <SelectMenu
                id="share-link-expiry"
                value={days}
                onChange={setDays}
                disabled={creating || limitReached}
                options={SHARE_EXPIRY_OPTIONS}
              />
            </div>
            <SharePasscodeControl
              enabled={passwordProtected}
              onChange={(enabled) => {
                setPasswordProtected(enabled);
                setError("");
              }}
              disabled={creating || limitReached}
              labelClassName="mb-1 block type-label text-[var(--text-secondary)]"
            />
          </div>
          {/* 提示行固定占位 18px：错误（红）/ 达到上限说明（灰）都不改变弹窗高度 */}
          <p
            className={`mt-2 h-[var(--line-height-caption)] type-caption ${
              limitReached && !error ? "text-[var(--text-secondary)]" : "text-[var(--danger-text)]"
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

        {/* 列表占用固定面板的剩余空间；内容增加时仅列表内部滚动，
            不改变弹窗尺寸。隐藏原生滚动条，滚轮、触控板和触摸滑动仍可用。 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-2 type-label text-[var(--text-primary)]">
            已有链接 {shares.length > 0 && `（${shares.length}）`}
          </p>
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {loading ? (
              <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-control)] type-caption text-[var(--text-secondary)]">
                加载中…
              </div>
            ) : shares.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-control)] type-caption text-[var(--text-secondary)]">
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
                    className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5"
                  >
                    <span className={`rounded-full px-2.5 py-0.5 type-badge ${st.cls}`}>
                      {st.label}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {/* 同组操作固定为 78×28px，避免文案切换或按钮样式造成尺寸差异 */}
                      <button
                        type="button"
                        onClick={() => rotate(s.id)}
                        disabled={!active || !!rotatingId || !!revokingId}
                        title="更换后旧链接立即失效，提取码与有效期保持不变"
                        className="inline-flex h-[28px] w-[78px] shrink-0 items-center justify-center rounded-full border border-[var(--border-control)] type-control-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--control-hover)] disabled:opacity-40"
                      >
                        {rotatingId === s.id ? "更换中…" : "更换链接"}
                      </button>
                      <CopyPillButton
                        text={() =>
                          shareClipboardText(
                            `${location.origin}/share/${s.token}`,
                            s.passcode,
                          )
                        }
                        label="复制链接"
                        disabled={!active}
                        className="inline-flex h-[28px] w-[78px] shrink-0 items-center justify-center rounded-full border border-[var(--border-control)] type-control-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--control-hover)] disabled:opacity-40"
                      />
                      <button
                        type="button"
                        onClick={() => revoke(s.id)}
                        disabled={!!revokingId || !!rotatingId}
                        className="inline-flex h-[28px] w-[78px] shrink-0 items-center justify-center rounded-full border border-[var(--danger-border)] type-control-sm text-[var(--danger-text)] transition-colors hover:bg-[var(--danger-soft)] disabled:opacity-40"
                      >
                        {revokingId === s.id ? "撤销中…" : "撤销"}
                      </button>
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
      </div>
    </Modal>
  );
}
