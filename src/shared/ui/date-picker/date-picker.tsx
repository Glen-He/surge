"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYMD(v: string) {
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const GAP = 6; // 弹层与触发器的间距
const EDGE = 8; // 弹层距视口边缘的最小间距

/** 弹层定位：fixed 视口坐标；top / bottom 二选一，maxHeight 保证不越出视口 */
interface PopPosition {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
}

/**
 * 现代轻量日期选择器：Filled 触发器 + 弹出月历
 * 值格式 yyyy-mm-dd；点击外部 / Esc 关闭。
 *
 * 弹层必须 portal 到 body 用 fixed 定位，不能留在原位：Modal body 的
 * overflow-y: auto（滚动容器会裁切越出的后代）和 .animate-fade-up 的
 * fill-mode: both（最终关键帧让弹窗常驻 transform，成为 fixed 的包含块、
 * 劫持坐标）都会破坏定位。placement 只是首选方向，该侧放不下时自动换边。
 */
export function DatePicker({
  value,
  onChange,
  error,
  min,
  placeholder = "选择日期",
  variant = "project",
  placement = "bottom",
  className = "",
  ariaLabel,
  clearLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  min?: string;
  placeholder?: string;
  variant?: "project" | "modal";
  /** 首选弹出方向；该侧视口空间放不下时自动换到另一侧 */
  placement?: "top" | "bottom";
  className?: string;
  ariaLabel?: string;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<"days" | "years">("days");
  const [pos, setPos] = useState<PopPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const initial = parseYMD(value) ?? new Date();
  const minDate = min ? parseYMD(min) : null;
  const [view, setView] = useState({
    y: initial.getFullYear(),
    m: initial.getMonth(),
  });

  function toggleOpen() {
    if (!open) {
      const d = parseYMD(value) ?? new Date();
      setView({ y: d.getFullYear(), m: d.getMonth() });
      setPicker("days");
      setPos(null); // 丢弃上次的定位，量完尺寸再显示，避免闪现在旧位置
    }
    setOpen((current) => !current);
  }

  /** 关闭弹层并把焦点还给触发器（选日期 / 清除 / Esc）；点击外部关闭时不抢焦点 */
  const closeWithFocusRestore = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // 重新定位。弹层首帧 visibility:hidden（见 JSX），在这里量尺寸是安全的
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) return;
    const rect = trigger.getBoundingClientRect();
    const popHeight = pop.offsetHeight;
    const popWidth = pop.offsetWidth;
    const spaceTop = rect.top - EDGE;
    const spaceBottom = window.innerHeight - rect.bottom - EDGE;
    let side = placement;
    if (side === "top" && popHeight + GAP > spaceTop && spaceBottom > spaceTop) {
      side = "bottom";
    } else if (
      side === "bottom" &&
      popHeight + GAP > spaceBottom &&
      spaceTop > spaceBottom
    ) {
      side = "top";
    }
    const maxHeight = Math.max(
      0,
      (side === "top" ? spaceTop : spaceBottom) - GAP,
    );
    const left = Math.min(
      Math.max(EDGE, rect.left),
      Math.max(EDGE, window.innerWidth - popWidth - EDGE),
    );
    setPos((prev) => {
      // 向上弹出时按 bottom 锚定：高度变化时弹层始终贴着触发器向上生长，
      // 不需要知道弹层真实高度就能保证不越出视口
      const next: PopPosition =
        side === "top"
          ? { bottom: window.innerHeight - rect.top + GAP, left, maxHeight }
          : { top: rect.bottom + GAP, left, maxHeight };
      const unchanged =
        prev &&
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.left === next.left &&
        prev.maxHeight === next.maxHeight;
      return unchanged ? prev : next;
    });
  }, [placement]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    // Modal body / 页面滚动（capture 捕获子元素滚动）与视口变化时跟随触发器
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // 点击外部 / Esc 关闭；Tab 在弹层内循环（portal 后弹层不在 Modal 焦点圈内）
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      // 弹层已 portal 到 body，不在 rootRef 内，需要单独包含
      if (rootRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // 阻止事件继续传到 Modal 挂在 window 上的监听，否则整个弹窗一起被关
        e.stopPropagation();
        closeWithFocusRestore();
        return;
      }
      if (e.key !== "Tab") return;
      const pop = popRef.current;
      if (!pop) return;
      const focusables = Array.from(
        pop.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      if (focusables.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const index = active ? focusables.indexOf(active) : -1;
      const fromTrigger = active === triggerRef.current;
      if (index === -1 && !fromTrigger) return; // 焦点在别处：交给 Modal 焦点圈
      if (fromTrigger && e.shiftKey) return; // 反向离开弹层
      e.preventDefault();
      e.stopPropagation();
      if (fromTrigger) {
        focusables[0].focus();
        return;
      }
      const nextIndex = e.shiftKey
        ? index === 0
          ? focusables.length - 1
          : index - 1
        : index === focusables.length - 1
          ? 0
          : index + 1;
      focusables[nextIndex].focus();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closeWithFocusRestore]);

  const startWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...(Array(startWeekday).fill(null) as Array<null>),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = toYMD(new Date());

  function moveMonth(delta: number) {
    setView((v) => {
      const m = v.m + delta;
      const d = new Date(v.y, m, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  // 年份视图：一次展示 12 年，箭头整组翻页（跨年无需逐月点）
  const yearPage = Math.floor(view.y / 12) * 12;
  const years = Array.from({ length: 12 }, (_, i) => yearPage + i);
  const selectedYear = initial.getFullYear();

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`project-input date-trigger ${
          variant === "modal" ? "date-trigger-modal" : ""
        } ${error ? "project-input-error" : ""}`}
      >
        {/* 值格式 yyyy-mm-dd，与主页卡片日期显示一致 */}
        <span
          className={`min-w-0 flex-1 truncate ${value ? "" : "text-[var(--text-secondary)]"} ${
            clearLabel && value ? "mr-5" : ""
          }`}
        >
          {value || placeholder}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-[17px] w-[17px]"
        >
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {clearLabel && value && (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => {
            onChange("");
            closeWithFocusRestore();
          }}
          className="absolute right-9 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[var(--icon-muted)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--text-primary)]"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="h-3 w-3"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}

      {open &&
        createPortal(
          <div
            ref={popRef}
            className="date-pop"
            role="dialog"
            aria-label="选择日期"
            style={pos ?? { visibility: "hidden" }}
          >
            <div className="date-pop-head">
              <button
                type="button"
                onClick={() =>
                  picker === "days" ? moveMonth(-1) : setView((v) => ({ ...v, y: v.y - 12 }))
                }
                aria-label={picker === "days" ? "上个月" : "上一组年份"}
                className="date-nav"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setPicker((p) => (p === "days" ? "years" : "days"))}
                aria-label={picker === "days" ? "选择年份" : "返回日期选择"}
                className="date-pop-title"
              >
                {picker === "days" ? (
                  <>
                    {view.y} 年 {view.m + 1} 月
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </>
                ) : (
                  <>
                    {yearPage} - {yearPage + 11}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 date-pop-title-flip">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  picker === "days" ? moveMonth(1) : setView((v) => ({ ...v, y: v.y + 12 }))
                }
                aria-label={picker === "days" ? "下个月" : "下一组年份"}
                className="date-nav"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>

            {picker === "days" ? (
              <>
                <div className="date-week">
                  {WEEK.map((w) => (
                    <span key={w}>{w}</span>
                  ))}
                </div>

                <div className="date-grid">
                  {cells.map((d, i) => {
                    if (d === null) return <span key={i} />;
                    const ymd = toYMD(new Date(view.y, view.m, d));
                    const disabled = !!minDate && new Date(`${ymd}T00:00:00`) < minDate;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onChange(ymd);
                          closeWithFocusRestore();
                        }}
                        className={`date-day ${disabled ? "date-day-disabled" : ""} ${
                          ymd === value ? "date-day-sel" : ""
                        } ${ymd === today ? "date-day-today" : ""}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="date-year-grid">
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    disabled={!!minDate && y < minDate.getFullYear()}
                    onClick={() => {
                      setView((v) => ({ ...v, y }));
                      setPicker("days");
                    }}
                    className={`date-year ${
                      minDate && y < minDate.getFullYear() ? "date-year-disabled" : ""
                    } ${y === selectedYear ? "date-year-sel" : ""}`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
