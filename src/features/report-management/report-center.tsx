"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyIconButton } from "@/shared/ui/copy-feedback-button";
import { Modal } from "@/shared/ui/modal/modal";
import { ShareModal } from "@/features/sharing/share-modal";
import { ReportCardLink } from "@/features/reports/board/report-card-link";
import {
  SortableReportList,
  type SortableReportCardOptions,
} from "@/features/reports/board/report-sortable-list";
import { OtpCodeInput } from "@/features/auth/otp-code-input";
import type { ReportCardView as Report } from "@/features/reports/data/report-cards";

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
        className="absolute right-14 bottom-4 z-10 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full text-[#86868b] opacity-0 transition-all hover:bg-[rgba(0,0,0,0.06)] hover:text-[#1d1d1f] focus-visible:translate-y-0 focus-visible:opacity-100 group-hover/report-card:translate-y-0 group-hover/report-card:opacity-100 max-sm:translate-y-0 max-sm:opacity-100"
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
  const router = useRouter();
  // 输入与本次随机码完全一致才放开删除按钮
  const confirmed = typed === code && code !== "";

  // 打开弹窗时生成新的 6 位随机码并清空上次输入
  function showModal() {
    setCode(String(Math.floor(100000 + Math.random() * 900000)));
    setTyped("");
    setError("");
    setOpen(true);
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
        className="absolute right-24 bottom-4 z-10 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full text-[#86868b] opacity-0 transition-all hover:bg-[rgba(255,59,48,0.08)] hover:text-[#ff3b30] focus-visible:translate-y-0 focus-visible:opacity-100 group-hover/report-card:translate-y-0 group-hover/report-card:opacity-100 max-sm:translate-y-0 max-sm:opacity-100"
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
          及其全部报告文件，面板入口和分享链接同时失效。此操作不可恢复。
        </p>
        <p className="mt-4 text-[13px] leading-[1.7] text-[#6e6e73]">
          请输入验证码{" "}
          <span className="font-semibold text-[#1d1d1f]">
            {code}
            <CopyIconButton
              text={code}
              label="复制验证码"
              copiedLabel="验证码已复制"
              className="relative top-[2px]"
            />
          </span>{" "}
          以确认删除：
        </p>
        <OtpCodeInput
          value={typed}
          onValueChange={(value) => {
            setTyped(value);
            setError("");
          }}
          placeholder={code}
          autoComplete="off"
          aria-label="删除项目验证码"
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
  activeSession,
  canDrag,
  dragActivatorRef,
  suppressHover,
}: {
  r: Report;
} & Pick<
  SortableReportCardOptions,
  | "activeSession"
  | "canDrag"
  | "dragActivatorRef"
  | "suppressHover"
>) {
  const hoverEnabled = !activeSession && !suppressHover;
  return (
    <div
      className={`${hoverEnabled ? "group/report-card" : ""} report-card-touch-shell relative transition-transform duration-200 motion-reduce:transition-none ${
        hoverEnabled ? "hover:-translate-y-0.5" : ""
      }`}
    >
      <ReportCardLink
        report={r}
        href={`/report/${r.slug}`}
        draggable={canDrag}
        dragActivatorRef={dragActivatorRef}
      />
      {/* 源码顺序 = Tab 顺序，刻意与视觉从左到右一致（删除 → 分享 → 编辑） */}
      <DeleteIcon r={r} />
      <ShareIcon r={r} />
      <Link
        href={`/edit/${r.slug}`}
        draggable={false}
        aria-label={`编辑 ${r.title}`}
        title="编辑项目"
        className="absolute bottom-4 right-4 z-10 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full text-[#86868b] opacity-0 transition-all hover:bg-[rgba(0,0,0,0.06)] hover:text-[#1d1d1f] focus-visible:translate-y-0 focus-visible:opacity-100 group-hover/report-card:translate-y-0 group-hover/report-card:opacity-100 max-sm:translate-y-0 max-sm:opacity-100"
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

// 数据区组件：日期倒序；同一天内支持手动排序，也可跨日期拖动并自动改日期。
export function ReportList({
  reports,
  q,
}: {
  reports: Report[];
  q: string;
}): ReactNode {
  const identity = reports
    .map((report, index) => `${index}:${report.slug}:${report.date}`)
    .join("\0");
  return (
    <SortableReportList
      key={identity}
      reports={reports}
      q={q}
      renderCard={(report, options) => (
        <ReportCard key={report.slug} r={report} {...options} />
      )}
    />
  );
}
