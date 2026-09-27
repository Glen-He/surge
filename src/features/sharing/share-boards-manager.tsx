"use client";

import { useState } from "react";
import Link from "next/link";
import type { DisplayMode } from "@/features/reports/display-mode";
import { CopyPillButton } from "@/shared/ui/copy-feedback-button";
import { Modal } from "@/shared/ui/modal/modal";
import { SelectMenu } from "@/shared/ui/select-menu";
import { ShareManagementEmptyState } from "@/features/sharing/share-management-empty-state";
import { SharePasscodeControl } from "@/features/sharing/share-passcode-control";
import { SHARE_EXPIRY_OPTIONS, nearestShareExpiryDays, shareExpiryDate } from "@/features/sharing/share-expiry";
import type { ShareExpiryDays } from "@/features/sharing/share-expiry";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { shareClipboardText } from "@/features/sharing/share-copy";

export type ManagedBoard = {
  id: string;
  token: string;
  title: string;
  hasPassword: boolean;
  passcode: string | null;
  disabled: boolean;
  viewCount: number;
  itemCount: number;
  expiresAt: string | null;
  items: { slug: string; sharedAt: string; title: string; displayMode: DisplayMode }[];
};

function formatShareDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function ShareBoardsManager({
  initialBoards,
}: {
  initialBoards: ManagedBoard[];
}) {
  const [boards, setBoards] = useState(initialBoards);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPasswordProtected, setNewPasswordProtected] = useState(false);
  const [newExpiryDays, setNewExpiryDays] = useState<ShareExpiryDays>(0);
  const [newDisabled, setNewDisabled] = useState(false);
  const [newError, setNewError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ManagedBoard | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPasswordProtected, setEditPasswordProtected] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState(false);
  const [editDisabled, setEditDisabled] = useState(false);
  const [editExpiryDays, setEditExpiryDays] = useState<ShareExpiryDays>(0);
  // 打开设置时的档位快照：只有用户真正改过有效期才提交，避免保存其它字段时重置到期时钟
  const [editExpiryDaysOnOpen, setEditExpiryDaysOnOpen] = useState<ShareExpiryDays>(0);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ManagedBoard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function createBoard() {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    setNewError("");
    try {
      const response = await fetch("/api/share-boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          passwordProtected: newPasswordProtected,
          expiresInDays: newExpiryDays,
          disabled: newDisabled,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setNewError(data?.error ?? "创建失败，请重试");
        return;
      }
      setBoards((current) => [{ ...data.board, items: [] }, ...current]);
      setNewTitle("");
      setNewPasswordProtected(false);
      setNewExpiryDays(0);
      setNewDisabled(false);
      setNewOpen(false);
    } finally {
      setCreating(false);
    }
  }

  function openSettings(board: ManagedBoard) {
    setEditing(board);
    setEditTitle(board.title);
    setEditPasswordProtected(board.hasPassword);
    setRegeneratePassword(false);
    setEditDisabled(board.disabled);
    // 回显：按剩余时间取最接近的档位（永久/已过期显示「永久有效」），并与快照比较决定是否提交
    const preset = nearestShareExpiryDays(board.expiresAt ? new Date(board.expiresAt) : null);
    setEditExpiryDays(preset);
    setEditExpiryDaysOnOpen(preset);
    setEditError("");
  }

  async function saveSettings() {
    if (!editing || saving) return;
    setSaving(true);
    setEditError("");
    const body: Record<string, unknown> = {
      title: editTitle,
      disabled: editDisabled,
    };
    // 仅当用户改动过档位才提交有效期，避免「只改名称」顺带把到期时间重新计时
    if (editExpiryDays !== editExpiryDaysOnOpen) body.expiresInDays = editExpiryDays;
    if (!editPasswordProtected) body.password = null;
    else if (!editing.hasPassword || regeneratePassword) body.regeneratePassword = true;
    try {
      const response = await fetch(`/api/share-boards/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setEditError(data?.error ?? "保存失败，请重试");
        return;
      }
      const expiryChanged = editExpiryDays !== editExpiryDaysOnOpen;
      const nextExpiresAt = expiryChanged
        ? (shareExpiryDate(editExpiryDays)?.toISOString() ?? null)
        : undefined;
      setBoards((current) => current.map((board) =>
        board.id === editing.id
          ? {
              ...board,
              title: editTitle.trim(),
              disabled: editDisabled,
              hasPassword: editPasswordProtected,
              passcode: !editPasswordProtected
                ? null
                : data?.passcode ?? board.passcode,
              expiresAt: nextExpiresAt === undefined ? board.expiresAt : nextExpiresAt,
            }
          : board,
      ));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  async function rotateToken(board: ManagedBoard) {
    if (busyId) return;
    setBusyId(board.id);
    try {
      const response = await fetch(`/api/share-boards/${board.id}/rotate-token`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.token) {
        setBoards((current) => current.map((item) => item.id === board.id ? { ...item, token: data.token } : item));
        if (editing?.id === board.id) setEditing({ ...editing, token: data.token });
      } else {
        setEditError(data?.error ?? "更换链接失败，请重试");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function removeItem(board: ManagedBoard, slug: string) {
    if (busyId) return;
    setBusyId(`${board.id}:${slug}`);
    try {
      const response = await fetch(`/api/reports/${slug}/boards/${board.id}`, { method: "DELETE" });
      if (response.ok) {
        setBoards((current) => current.map((item) => item.id === board.id
          ? { ...item, itemCount: item.itemCount - 1, items: item.items.filter((report) => report.slug !== slug) }
          : item));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBoard() {
    if (!deleting || busyId) return;
    setBusyId(deleting.id);
    try {
      const response = await fetch(`/api/share-boards/${deleting.id}`, { method: "DELETE" });
      if (response.ok) {
        setBoards((current) => current.filter((board) => board.id !== deleting.id));
        setDeleting(null);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mb-14">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="type-section-title tracking-[-0.01em]">分享面板</h2>
          <p className="mt-1 type-caption text-[var(--text-secondary)]">按查看对象创建不同面板，同一汇报可加入多个面板。</p>
        </div>
        <div className="group/new-board relative shrink-0">
          <button
            type="button"
            aria-label="新建面板"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-on-fill)] shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-[transform,background-color,box-shadow] duration-200 ease-out hover:scale-[1.03] hover:bg-[var(--accent-hover)] hover:shadow-[0_6px_16px_rgba(0,113,227,0.2)] active:scale-[0.96]"
            onClick={() => setNewOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="h-[19px] w-[19px] transition-transform duration-200 ease-out group-hover/new-board:rotate-90"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 type-badge text-[var(--text-primary)] shadow-[0_4px_12px_rgba(0,0,0,0.08)] opacity-0 transition-opacity duration-150 group-hover/new-board:opacity-100 group-hover/new-board:delay-[60ms]">
            新建面板
          </span>
        </div>
      </div>

      {boards.length === 0 ? (
        <ShareManagementEmptyState
          title="还没有分享面板"
          hint="新建后，可在任意汇报的分享弹窗中选择加入。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {boards.map((board) => (
            <article
              key={board.id}
              className="flex flex-col rounded-[var(--radius-xl)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.025)]"
              style={{ height: 270, minHeight: 270, maxHeight: 270 }}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {/* 与分享链接卡片一致：点标题进入内容（面板页），新标签打开，不打断管理页 */}
                  <h3 className="type-card-title">
                    <Link
                      href={`/board/${board.token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate hover:text-[var(--accent-text)]"
                    >
                      {board.title}
                    </Link>
                  </h3>
                  <p className="mt-1 truncate type-caption text-[var(--text-secondary)]">{board.passcode ? `提取码 ${board.passcode}` : "无需提取码"} · {board.expiresAt ? `${board.expiresAt.slice(0, 10)} 到期` : "长期有效"} · {board.itemCount} 份汇报 · {board.viewCount} 次浏览</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 type-badge ${board.disabled ? "bg-[var(--control-bg)] text-[var(--text-secondary)]" : "bg-[var(--success-soft)] text-[var(--success-text)]"}`}>
                  {board.disabled ? "已停用" : "生效中"}
                </span>
              </div>

              <div className="mt-4 h-[118px] shrink-0 space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {board.items.length === 0 ? (
                  <p className="rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-3 py-3 type-caption text-[var(--text-secondary)]">暂无汇报，请从汇报的分享弹窗加入</p>
                ) : board.items.map((report) => (
                  <div key={report.slug} className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-3 py-2">
                    <Link href={`/view/${report.slug}`} target={report.displayMode === "bare" ? "_blank" : undefined} rel={report.displayMode === "bare" ? "noopener noreferrer" : undefined} className="min-w-0 flex-1 truncate type-label hover:text-[var(--accent-text)]">{report.title}</Link>
                    {report.displayMode === "bare" && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 type-badge text-[var(--accent-text)]">网页</span>
                    )}
                    <time dateTime={report.sharedAt} className="shrink-0 type-caption tabular-nums text-[var(--text-secondary)]">
                      {formatShareDate(report.sharedAt)}
                    </time>
                    <button
                      type="button"
                      aria-label={`从面板移除 ${report.title}`}
                      onClick={() => removeItem(board, report.slug)}
                      disabled={busyId === `${board.id}:${report.slug}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--icon-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)] disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-end gap-3">
                {/* 与「复制链接」同款浅色胶囊，放在其左侧 */}
                <button
                  type="button"
                  onClick={() => openSettings(board)}
                  className="inline-flex h-8 w-[96px] items-center justify-center rounded-full bg-[var(--control-bg)] type-control-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--control-hover)]"
                >
                  设置
                </button>
                <CopyPillButton
                  text={() =>
                    shareClipboardText(
                      `${location.origin}/board/${board.token}`,
                      board.passcode,
                    )
                  }
                  label="复制链接"
                  disabled={board.disabled}
                  className="inline-flex h-8 w-[96px] items-center justify-center rounded-full bg-[var(--control-bg)] type-control-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--control-hover)] disabled:text-[var(--text-disabled)] disabled:opacity-60"
                />
                {!board.disabled && (
                  <Link
                    href={`/board/${board.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 w-[96px] items-center justify-center gap-1 rounded-full bg-[var(--accent)] type-control-sm text-[var(--text-on-fill)] transition-colors hover:bg-[var(--accent-hover)]"
                  >
                    打开面板
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-8 8" />
                      <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
                    </svg>
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="新建分享面板" plainHeader busy={creating} dirty={!!newTitle || newPasswordProtected || newExpiryDays !== 0 || newDisabled}>
        {/* 2×2 网格：桌面两列（sm+），手机端每列约 142px 放不下「开关框 + 文字」（访问保护框
            开启态需约 188px），退化为 1×4 单列，与分享卡片的 sm:grid-cols-2 模式一致。
            间距口径与新建项目页对齐：列间距 16px = 基本信息行（日期/展示模式）间距；
            行间距 10px = 项目名称容器 → 日期容器的间距（说明/错误槽算在上方容器内） */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
          <div>
            <label className="mb-2 block type-label">面板名称</label>
            <input value={newTitle} onChange={(event) => { setNewTitle(event.target.value); setNewError(""); }} maxLength={40} placeholder="例如：课题组周会" className="h-[40px] w-full rounded-[var(--radius-md)] border border-[var(--border-control)] px-3 type-input outline-none focus:border-[var(--accent)]" />
          </div>
          <div>
            <span className="mb-2 block type-label">有效期</span>
            <SelectMenu
              id="new-board-expiry"
              value={newExpiryDays}
              onChange={(value) => {
                setNewExpiryDays(value);
                setNewError("");
              }}
              disabled={creating}
              options={SHARE_EXPIRY_OPTIONS}
            />
          </div>
          <SharePasscodeControl enabled={newPasswordProtected} onChange={(enabled) => { setNewPasswordProtected(enabled); setNewError(""); }} disabled={creating} />
          <div>
            <span className="mb-2 block type-label">访问状态</span>
            <div className="flex h-[40px] items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-control)] bg-[var(--surface)] px-3">
              <span className="type-input text-[var(--text-primary)]">暂停公开访问</span>
              <ToggleSwitch
                checked={newDisabled}
                label="暂停公开访问"
                onChange={(checked) => { setNewDisabled(checked); setNewError(""); }}
              />
            </div>
          </div>
        </div>
        <p className="mt-2 h-[var(--line-height-caption)] type-caption text-[var(--danger-text)]">{newError}</p>
        <div className="mt-4 flex justify-end gap-2.5">
          <button type="button" onClick={() => setNewOpen(false)} className="btn-secondary">取消</button>
          <button type="button" onClick={createBoard} disabled={!newTitle.trim() || creating} className="btn-primary">{creating ? "创建中…" : "创建面板"}</button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="面板设置" plainHeader busy={saving} dirty={!!editing && (editTitle !== editing.title || editPasswordProtected !== editing.hasPassword || regeneratePassword || editDisabled !== editing.disabled || editExpiryDays !== editExpiryDaysOnOpen)}>
        {editing && (
          <>
            {/* 2×2 网格：上行 面板名称 + 有效期，下行 访问保护 + 访问状态；
                手机端列宽不足（见新建弹窗注释），退化为 1×4 单列。
                间距口径同新建弹窗：列 16px（= 基本信息行）、行 10px（= 项目名称→日期容器） */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block type-label">面板名称</label>
                <input value={editTitle} onChange={(event) => { setEditTitle(event.target.value); setEditError(""); }} maxLength={40} className="h-[40px] w-full rounded-[var(--radius-md)] border border-[var(--border-control)] px-3 type-input outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <span className="mb-2 block type-label">有效期</span>
                <SelectMenu
                  id="edit-board-expiry"
                  value={editExpiryDays}
                  onChange={(value) => {
                    setEditExpiryDays(value);
                    setEditError("");
                  }}
                  disabled={saving}
                  options={SHARE_EXPIRY_OPTIONS}
                />
              </div>
              <SharePasscodeControl
                enabled={editPasswordProtected}
                onChange={(enabled) => {
                  setEditPasswordProtected(enabled);
                  setRegeneratePassword(enabled && !editing.hasPassword);
                  setEditError("");
                }}
                disabled={saving}
              />
              <div>
                <span className="mb-2 block type-label">访问状态</span>
                <div className="flex h-[40px] items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-control)] bg-[var(--surface)] px-3">
                  <span className="type-input text-[var(--text-primary)]">暂停公开访问</span>
                  <ToggleSwitch
                    checked={editDisabled}
                    label="暂停公开访问"
                    onChange={setEditDisabled}
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] p-3">
              <p className="type-caption text-[var(--text-secondary)]">更换链接后，旧链接立即失效，面板内容和设置保持不变。</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" onClick={() => rotateToken(editing)} disabled={busyId === editing.id} className="type-control-sm text-[var(--accent-text)]">{busyId === editing.id ? "更换中…" : "更换链接"}</button>
                <button type="button" onClick={() => { setEditing(null); setDeleting(editing); }} className="type-control-sm text-[var(--danger-text)]">删除面板</button>
              </div>
            </div>
            <p className="mt-2 h-[var(--line-height-caption)] type-caption text-[var(--danger-text)]">{editError}</p>
            <div className="mt-4 flex justify-end gap-2.5">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary">取消</button>
              <button type="button" onClick={saveSettings} disabled={!editTitle.trim() || saving} className="btn-primary">{saving ? "保存中…" : "保存设置"}</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="删除分享面板" plainHeader busy={!!deleting && busyId === deleting.id}>
        <p className="type-body">删除后，面板链接及已打开的面板汇报会立即失效；原有分享链接不受影响。</p>
        <p className="mt-2 h-[var(--line-height-caption)] type-caption text-[var(--text-secondary)]">{deleting ? `即将删除：${deleting.title}` : ""}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={() => setDeleting(null)} className="btn-secondary">取消</button>
          <button type="button" onClick={deleteBoard} disabled={!deleting || busyId === deleting?.id} className="btn-danger">{busyId === deleting?.id ? "删除中…" : "确认删除"}</button>
        </div>
      </Modal>
    </section>
  );
}
