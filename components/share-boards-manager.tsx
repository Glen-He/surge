"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/modal";
import { ShareManagementEmptyState } from "@/components/share-management-empty-state";
import { SharePasscodeControl } from "@/components/share-passcode-control";
import { shareClipboardText } from "@/lib/share-copy";

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
  items: { slug: string; date: string; title: string }[];
};

async function copyText(value: string) {
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

export function ShareBoardsManager({
  initialBoards,
  minExpiryDate,
}: {
  initialBoards: ManagedBoard[];
  minExpiryDate: string;
}) {
  const [boards, setBoards] = useState(initialBoards);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPasswordProtected, setNewPasswordProtected] = useState(false);
  const [newExpiresOn, setNewExpiresOn] = useState("");
  const [newError, setNewError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ManagedBoard | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPasswordProtected, setEditPasswordProtected] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState(false);
  const [editDisabled, setEditDisabled] = useState(false);
  const [editExpiresOn, setEditExpiresOn] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ManagedBoard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
          expiresOn: newExpiresOn || null,
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
      setNewExpiresOn("");
      setNewOpen(false);
    } finally {
      setCreating(false);
    }
  }

  async function copyBoard(board: ManagedBoard) {
    await copyText(
      shareClipboardText(`${location.origin}/b/${board.token}`, board.passcode),
    );
    setCopiedId(board.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function openSettings(board: ManagedBoard) {
    setEditing(board);
    setEditTitle(board.title);
    setEditPasswordProtected(board.hasPassword);
    setRegeneratePassword(false);
    setEditDisabled(board.disabled);
    setEditExpiresOn(board.expiresAt ? board.expiresAt.slice(0, 10) : "");
    setEditError("");
  }

  async function saveSettings() {
    if (!editing || saving) return;
    setSaving(true);
    setEditError("");
    const body: Record<string, unknown> = {
      title: editTitle,
      disabled: editDisabled,
      expiresOn: editExpiresOn || null,
    };
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
              expiresAt: editExpiresOn ? `${editExpiresOn}T23:59:59.999+08:00` : null,
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
          <h2 className="text-[21px] font-semibold tracking-[-0.01em]">分享面板</h2>
          <p className="mt-1 text-[13px] text-[#6e6e73]">按查看对象创建不同面板，同一汇报可加入多个面板。</p>
        </div>
        <div className="group/new-board relative shrink-0">
          <button
            type="button"
            aria-label="新建面板"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0071e3] text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-[transform,background-color,box-shadow] duration-200 ease-out hover:scale-[1.03] hover:bg-[#0077ed] hover:shadow-[0_6px_16px_rgba(0,113,227,0.2)] active:scale-[0.96]"
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
          <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[rgba(0,0,0,0.08)] bg-white px-3 py-1 text-[12px] font-medium text-[#1d1d1f] shadow-[0_4px_12px_rgba(0,0,0,0.08)] opacity-0 transition-opacity duration-150 group-hover/new-board:opacity-100 group-hover/new-board:delay-[60ms]">
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
            <article key={board.id} className="flex min-h-[250px] flex-col rounded-[20px] bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.025)]">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[17px] font-semibold">{board.title}</h3>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${board.disabled ? "bg-[#f2f2f7] text-[#6e6e73]" : "bg-[#e9fbe9] text-[#166534]"}`}>
                      {board.disabled ? "已停用" : "生效中"}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-[#6e6e73]">{board.passcode ? `提取码 ${board.passcode}` : "无需提取码"} · {board.expiresAt ? `${board.expiresAt.slice(0, 10)} 到期` : "长期有效"} · {board.itemCount} 份汇报 · {board.viewCount} 次访问</p>
                </div>
                <button type="button" onClick={() => openSettings(board)} className="h-8 rounded-full bg-[#f2f2f7] px-3 text-[12px] font-medium hover:bg-[#e8e8ed]">设置</button>
              </div>

              <div className="mt-4 max-h-[118px] flex-1 space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {board.items.length === 0 ? (
                  <p className="rounded-[10px] bg-[#f9f9fb] px-3 py-3 text-[12px] text-[#6e6e73]">暂无汇报，请从汇报的分享弹窗加入</p>
                ) : board.items.map((report) => (
                  <div key={report.slug} className="flex items-center gap-2 rounded-[10px] bg-[#f9f9fb] px-3 py-2">
                    <Link href={`/report/${report.slug}`} className="min-w-0 flex-1 truncate text-[12px] font-medium hover:text-[#0071e3]">{report.title}</Link>
                    <span className="shrink-0 text-[11px] text-[#86868b]">{report.date}</span>
                    <button
                      type="button"
                      aria-label={`从面板移除 ${report.title}`}
                      onClick={() => removeItem(board, report.slug)}
                      disabled={busyId === `${board.id}:${report.slug}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#86868b] hover:bg-[rgba(255,59,48,0.08)] hover:text-[#ff3b30] disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => copyBoard(board)}
                  disabled={board.disabled}
                  className="inline-flex h-8 w-[96px] items-center justify-center rounded-full bg-[#f2f2f7] text-[12px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#e8e8ed] disabled:text-[#86868b] disabled:opacity-60"
                >
                  {copiedId === board.id ? "已复制" : "复制链接"}
                </button>
                {!board.disabled && (
                  <Link
                    href={`/b/${board.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 w-[96px] items-center justify-center gap-1 rounded-full bg-[#0071e3] text-[12px] font-semibold text-white transition-colors hover:bg-[#0077ed]"
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

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="新建分享面板" plainHeader busy={creating} dirty={!!newTitle || newPasswordProtected || !!newExpiresOn}>
        <label className="block text-[13px] font-medium">面板名称</label>
        <input value={newTitle} onChange={(event) => { setNewTitle(event.target.value); setNewError(""); }} maxLength={40} placeholder="例如：课题组周会" className="mt-2 h-[42px] w-full rounded-[10px] border border-black/12 px-3 text-[14px] outline-none focus:border-[#0071e3]" />
        <div className="mt-4">
          <SharePasscodeControl enabled={newPasswordProtected} onChange={(enabled) => { setNewPasswordProtected(enabled); setNewError(""); }} disabled={creating} />
        </div>
        <label className="mt-4 block text-[13px] font-medium">有效期（可选）</label>
        <input type="date" value={newExpiresOn} min={minExpiryDate} onChange={(event) => { setNewExpiresOn(event.target.value); setNewError(""); }} className="mt-2 h-[42px] w-full rounded-[10px] border border-black/12 px-3 text-[14px] outline-none focus:border-[#0071e3]" />
        <p className="mt-2 h-[18px] text-[13px] leading-[18px] text-[#ff3b30]">{newError}</p>
        <div className="mt-4 flex justify-end gap-2.5">
          <button type="button" onClick={() => setNewOpen(false)} className="btn-secondary">取消</button>
          <button type="button" onClick={createBoard} disabled={!newTitle.trim() || creating} className="btn-primary">{creating ? "创建中…" : "创建面板"}</button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="面板设置" plainHeader busy={saving} dirty={!!editing && (editTitle !== editing.title || editPasswordProtected !== editing.hasPassword || regeneratePassword || editDisabled !== editing.disabled || editExpiresOn !== (editing.expiresAt?.slice(0, 10) ?? ""))}>
        {editing && (
          <>
            <label className="block text-[13px] font-medium">面板名称</label>
            <input value={editTitle} onChange={(event) => { setEditTitle(event.target.value); setEditError(""); }} maxLength={40} className="mt-2 h-[42px] w-full rounded-[10px] border border-black/12 px-3 text-[14px] outline-none focus:border-[#0071e3]" />
            <div className="mt-4">
              <SharePasscodeControl
                enabled={editPasswordProtected}
                onChange={(enabled) => {
                  setEditPasswordProtected(enabled);
                  setRegeneratePassword(enabled && !editing.hasPassword);
                  setEditError("");
                }}
                disabled={saving}
              />
              <div className="mt-2 flex h-[18px] items-center text-[12px] leading-[18px] text-[#6e6e73]">
                {editPasswordProtected ? (
                  regeneratePassword || !editing.hasPassword ? (
                    <span>保存后自动生成新的 4 位提取码</span>
                  ) : (
                    <button type="button" onClick={() => setRegeneratePassword(true)} className="font-semibold text-[#0071e3]">
                      重新生成提取码
                    </button>
                  )
                ) : null}
              </div>
            </div>
            <label className="mt-4 block text-[13px] font-medium">有效期（可选）</label>
            <input type="date" value={editExpiresOn} min={minExpiryDate} onChange={(event) => { setEditExpiresOn(event.target.value); setEditError(""); }} className="mt-2 h-[42px] w-full rounded-[10px] border border-black/12 px-3 text-[14px] outline-none focus:border-[#0071e3]" />
            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-[13px] text-[#6e6e73]"><input type="checkbox" checked={editDisabled} onChange={(event) => setEditDisabled(event.target.checked)} />暂停公开访问</label>
            </div>
            <div className="mt-4 rounded-[12px] bg-[#f9f9fb] p-3">
              <p className="text-[12px] leading-[1.55] text-[#6e6e73]">更换链接后，旧链接立即失效，面板内容和设置保持不变。</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" onClick={() => rotateToken(editing)} disabled={busyId === editing.id} className="text-[12px] font-semibold text-[#0071e3]">{busyId === editing.id ? "更换中…" : "更换公开链接"}</button>
                <button type="button" onClick={() => { setEditing(null); setDeleting(editing); }} className="text-[12px] font-semibold text-[#ff3b30]">删除面板</button>
              </div>
            </div>
            <p className="mt-2 h-[18px] text-[13px] leading-[18px] text-[#ff3b30]">{editError}</p>
            <div className="mt-4 flex justify-end gap-2.5">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary">取消</button>
              <button type="button" onClick={saveSettings} disabled={!editTitle.trim() || saving} className="btn-primary">{saving ? "保存中…" : "保存设置"}</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="删除分享面板" plainHeader busy={!!deleting && busyId === deleting.id}>
        <p className="text-[14px] leading-[1.6]">删除后，面板链接及已打开的面板汇报会立即失效；原有分享链接不受影响。</p>
        <p className="mt-2 h-[18px] text-[13px] leading-[18px] text-[#6e6e73]">{deleting ? `即将删除：${deleting.title}` : ""}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={() => setDeleting(null)} className="btn-secondary">取消</button>
          <button type="button" onClick={deleteBoard} disabled={!deleting || busyId === deleting?.id} className="btn-danger">{busyId === deleting?.id ? "删除中…" : "确认删除"}</button>
        </div>
      </Modal>
    </section>
  );
}
