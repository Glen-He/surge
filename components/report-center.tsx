"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { ShareModal } from "@/components/share-modal";
import { EmptyState } from "@/components/empty-state";
import type { ReportCardView as Report } from "@/lib/report-cards";
import { tagTextColor } from "@/lib/tag-colors";

export type SortKey = "date_desc" | "date_asc" | "title_asc" | "title_desc";

export type SortOrQuery = { q: string; sort: SortKey };

// 搜索工具栏：居中；即时过滤（Spotlight 式，输入停顿 300ms 自动生效），
// 回车立即提交；叉叉清除搜索
export function Toolbar({ onSearch }: { onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState("");
  const searchRef = useRef(onSearch);
  useEffect(() => {
    searchRef.current = onSearch;
  }, [onSearch]);

  // 防抖即时搜索：数据全在客户端，300ms 停顿后自动过滤
  useEffect(() => {
    const t = setTimeout(() => searchRef.current(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  function submit() {
    searchRef.current(draft.trim());
  }

  function clear() {
    setDraft("");
    searchRef.current("");
  }

  return (
    <div className="flex justify-center">
      {/* 工具区 = 搜索框(536px) + 56px 间距 + 新建按钮(52px)，整体 644px 居中 */}
      <div className="flex w-[644px] max-w-full items-center gap-14">
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="pointer-events-none absolute left-3.5 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-[#86868b]"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="搜索标题、标签、简介、日期…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoComplete="off"
            className="h-[50px] w-full rounded-full border border-[rgba(0,0,0,0.08)] bg-white pl-10 pr-10 text-[14px] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
          />
          {draft !== "" && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={clear}
              className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[#86868b] transition-colors hover:bg-[rgba(0,0,0,0.06)] hover:text-[#1d1d1f]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-[15px] w-[15px]"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
        <NewProjectButton />
      </div>
    </div>
  );
}

function matches(r: Report, q: string): boolean {
  if (!q) return true;
  const hay = [r.title, r.desc, r.tag, r.date, ...(r.keywords)]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${y} 年 ${parseInt(m, 10)} 月`;
}

// 新建项目圆形按钮：52px 苹果黑圆白＋（SVG 双线 24px stroke 2.5），
// hover 放大 1.03 + ＋ 旋转 90° + 轻阴影（200ms ease-out），按压缩到 0.96；
// 胶囊 Tooltip 在按钮下方（白底深字 + 细边框轻阴影），延迟 60ms 滤掉
// 快速划过、随后 150ms 淡入；移出立即消失
function NewProjectButton() {
  return (
    <div className="group/new relative shrink-0">
      <Link
        href="/new-report"
        aria-label="新建项目"
        className="flex h-[52px] w-[52px] cursor-pointer items-center justify-center rounded-full bg-[#1d1d1f] text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-[transform,box-shadow] duration-200 ease-out hover:scale-[1.03] hover:shadow-[0_6px_16px_rgba(0,0,0,0.16)] active:scale-[0.96]"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="h-6 w-6 transition-transform duration-200 ease-out group-hover/new:rotate-90"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
      <span className="pointer-events-none absolute left-1/2 top-full mt-2.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-[rgba(0,0,0,0.08)] bg-white px-3 py-1 text-[12px] font-medium text-[#1d1d1f] shadow-[0_4px_12px_rgba(0,0,0,0.08)] opacity-0 transition-opacity duration-150 group-hover/new:opacity-100 group-hover/new:delay-[60ms]">
        新建项目
      </span>
    </div>
  );
}

function ShareIcon({ r }: { r: Report }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        draggable={false}
        onClick={() => setOpen(true)}
        aria-label={`分享 ${r.title}`}
        title="分享项目"
        className="absolute right-14 bottom-4 z-10 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full text-[#86868b] opacity-0 transition-all hover:bg-[rgba(0,0,0,0.06)] hover:text-[#1d1d1f] focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 max-sm:translate-y-0 max-sm:opacity-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-[15px] w-[15px]"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      </button>
      <ShareModal open={open} onClose={() => setOpen(false)} slug={r.slug} title={r.title} />
    </>
  );
}

// 删除确认弹窗：输入弹窗内展示的随机 6 位数字才可执行（高破坏性操作的强确认）
function DeleteIcon({ r }: { r: Report }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  // 输入与本次随机码完全一致才放开删除按钮
  const confirmed = typed === code && code !== "";

  // 打开弹窗时生成新的 6 位随机码并清空上次输入
  function showModal() {
    setCode(String(Math.floor(100000 + Math.random() * 900000)));
    setTyped("");
    setError("");
    setCopied(false);
    setOpen(true);
  }

  // 一键复制验证码：免去对照手打
  async function copyCode() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function remove() {
    if (deleting || !confirmed) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${r.slug}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "删除失败，请重试");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        draggable={false}
        onClick={showModal}
        aria-label={`删除 ${r.title}`}
        title="删除项目"
        className="absolute right-24 bottom-4 z-10 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full text-[#86868b] opacity-0 transition-all hover:bg-[rgba(255,59,48,0.08)] hover:text-[#ff3b30] focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 max-sm:translate-y-0 max-sm:opacity-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-[15px] w-[15px]"
        >
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="删除项目"
        busy={deleting}
        plainHeader
      >
        <p className="text-[14px] leading-[1.6] text-[#1d1d1f]">
          即将删除 <span className="font-semibold">{r.title}</span>{" "}
          及其全部报告文件，分享链接同时失效。此操作不可恢复。
        </p>
        <p className="mt-4 text-[13px] leading-[1.7] text-[#6e6e73]">
          请输入验证码{" "}
          <span className="font-semibold text-[#1d1d1f]">
            {code}
            <button
              type="button"
              onClick={copyCode}
              aria-label="复制验证码"
              title={copied ? "已复制" : "复制验证码"}
              className="relative top-[2px] ml-1 inline-flex h-4 w-4 items-center justify-center text-[#86868b] transition-colors hover:text-[#1d1d1f]"
            >
              {copied ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-3 w-3" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              )}
            </button>
          </span>{" "}
          以确认删除：
        </p>
        <input
          type="text"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value.replace(/\D/g, "").slice(0, 6));
            setError("");
          }}
          placeholder={code}
          inputMode="numeric"
          autoComplete="off"
          className="mt-2 h-[42px] w-full rounded-[10px] border border-black/12 bg-white px-3 text-[14px] tracking-[0.2em] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
        />
        {/* 错误行固定占位，避免出现时布局跳动 */}
        <p className="mt-2 h-[18px] text-[13px] leading-[18px] text-[#ff3b30]">{error}</p>
        <div className="mt-3 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={deleting}
            className="btn-secondary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={!confirmed || deleting}
            className="btn-danger"
          >
            {deleting ? "删除中…" : "删除"}
          </button>
        </div>
      </Modal>
    </>
  );
}

function ReportCard({
  r,
  draggable,
  dragging,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDragEnd,
}: {
  r: Report;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`group relative transition-transform duration-200 hover:-translate-y-0.5 ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <Link
        href={`/report/${r.slug}`}
        draggable={false}
        className={`flex h-[208px] flex-col justify-between overflow-hidden rounded-[18px] border border-[rgba(0,0,0,0.055)] bg-[rgba(255,255,255,0.94)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] transition-shadow group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] ${
          draggable ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <div>
          <div className="flex items-center justify-between gap-2">
            <span
              className="rounded-full px-3 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: r.tagColor, color: tagTextColor(r.tagColor) }}
            >
              {r.tag}
            </span>
            <span className="whitespace-nowrap text-xs text-[#6e6e73] tabular-nums">
              {r.date}
            </span>
          </div>
          <h2 className="mt-2.5 line-clamp-2 text-[18px] font-semibold leading-[1.3] tracking-tight text-[#1d1d1f]">
            {r.title}
          </h2>
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-normal text-[#6e6e73]">
            {r.desc}
          </p>
        </div>
        <div className="mt-2 translate-y-1 text-xs font-semibold text-[#0071e3] opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100 max-sm:translate-y-0 max-sm:opacity-100">
          查看报告
        </div>
      </Link>
      {/* 源码顺序 = Tab 顺序，刻意与视觉从左到右一致（删除 → 分享 → 编辑） */}
      <DeleteIcon r={r} />
      <ShareIcon r={r} />
      <Link
        href={`/edit/${r.slug}`}
        draggable={false}
        aria-label={`编辑 ${r.title}`}
        title="编辑项目"
        className="absolute bottom-4 right-4 z-10 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full text-[#86868b] opacity-0 transition-all hover:bg-[rgba(0,0,0,0.06)] hover:text-[#1d1d1f] focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 max-sm:translate-y-0 max-sm:opacity-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-[15px] w-[15px]"
        >
          <path d="M4 20h4L19 9a2.12 2.12 0 0 0-3-3L5 17l-1 3Z" />
          <path d="m14.5 7.5 3 3" />
        </svg>
      </Link>
    </div>
  );
}

// 数据区组件：只渲染列表/空状态；显示顺序 = 手动顺序，支持同月内拖拽调序
export function ReportList({
  reports,
  q,
}: {
  reports: Report[];
  q: string;
}): ReactNode {
  const identity = reports.map((report) => report.slug).join("\0");
  return <ReportListState key={identity} reports={reports} q={q} />;
}

function ReportListState({
  reports,
  q,
}: {
  reports: Report[];
  q: string;
}): ReactNode {
  // 手动顺序（slug 序列）：服务端顺序为初始值，拖拽后本地即时更新
  const [order, setOrder] = useState<string[]>(() => reports.map((r) => r.slug));
  const [dragSlug, setDragSlug] = useState<string | null>(null);

  const bySlug = useMemo(
    () => new Map(reports.map((r) => [r.slug, r] as const)),
    [reports],
  );
  const ordered = useMemo(
    () =>
      order
        .map((s) => bySlug.get(s))
        .filter((r): r is Report => Boolean(r)),
    [order, bySlug],
  );

  const canDrag = q.trim() === "";

  function handleDragEnter(target: string) {
    if (!dragSlug || dragSlug === target) return;
    const a = bySlug.get(dragSlug);
    const b = bySlug.get(target);
    // 仅允许同一天分组内调序
    if (!a || !b || a.date.slice(0, 10) !== b.date.slice(0, 10)) return;
    setOrder((prev) => {
      const from = prev.indexOf(dragSlug);
      const to = prev.indexOf(target);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragSlug);
      return next;
    });
  }

  function handleDragEnd() {
    if (dragSlug) {
      void fetch("/api/reports/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: order }),
      });
    }
    setDragSlug(null);
  }

  const list = useMemo(
    () => ordered.filter((r) => matches(r, q.trim().toLowerCase())),
    [ordered, q],
  );

  const groups = useMemo(() => {
    // 两层分组：先按月 → 月内再按天
    const months = new Map<
      string,
      { key: string; days: { key: string; items: Report[] }[] }
    >();
    list.forEach((r) => {
      const mk = r.date.slice(0, 7);
      const dk = r.date.slice(0, 10);
      if (!months.has(mk)) months.set(mk, { key: mk, days: [] });
      const month = months.get(mk)!;
      let day = month.days.find((d) => d.key === dk);
      if (!day) {
        day = { key: dk, items: [] };
        month.days.push(day);
      }
      day.items.push(r);
    });
    return [...months.values()];
  }, [list]);

  return (
    <div className="mt-16">
      {list.length === 0 && (
        <EmptyState
          icon="search"
          title="没有找到匹配的报告"
          hint="试试其他关键词或分类"
        />
      )}

      {groups.map((m) => (
        <section key={m.key} className="mb-10">
          {/* 月份分组标题：小字次级色（苹果日历模式——分组标题弱于内容标题） */}
          <h3 className="mb-10 flex items-center gap-3 text-[15px] font-medium text-[#6e6e73]">
            {monthLabel(m.key)}
            <span className="text-[13px] font-medium text-[#a1a1a6]">
              {m.days.reduce((n, d) => n + d.items.length, 0)} 份
            </span>
            <span className="h-px flex-1 bg-[rgba(0,0,0,0.08)]" />
          </h3>

          {m.days.map((g, gi) => (
            <div key={g.key}>
              {gi > 0 && (
                <div className="my-5 flex items-center justify-center gap-3">
                  <span className="h-px w-16 bg-[rgba(0,0,0,0.06)]" />
                  <span className="h-1 w-1 rounded-full bg-[#c7c7cc]" />
                  <span className="h-px w-16 bg-[rgba(0,0,0,0.06)]" />
                </div>
              )}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {g.items.map((r) => (
                  <ReportCard
                    key={r.slug}
                    r={r}
                    draggable={canDrag}
                    dragging={dragSlug === r.slug}
                    onDragStart={(e) => {
                      setDragSlug(r.slug);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", r.slug);
                    }}
                    onDragEnter={() => handleDragEnter(r.slug)}
                    onDragOver={(e) => {
                      if (dragSlug) e.preventDefault();
                    }}
                    onDragEnd={handleDragEnd}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
