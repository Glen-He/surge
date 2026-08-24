"use client";

import { useEffect, useRef, useState } from "react";

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

/**
 * 现代轻量日期选择器：Filled 触发器 + 弹出月历
 * 值格式 yyyy-mm-dd；点击外部 / Esc 关闭。
 */
export function DatePicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initial = parseYMD(value) ?? new Date();
  const [view, setView] = useState({
    y: initial.getFullYear(),
    m: initial.getMonth(),
  });

  // 打开时同步到当前值所在月份
  useEffect(() => {
    if (!open) return;
    const d = parseYMD(value) ?? new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }, [open, value]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`project-input date-trigger ${error ? "project-input-error" : ""}`}
      >
        {/* 值格式 yyyy-mm-dd，与主页卡片日期显示一致 */}
        <span>{value || "选择日期"}</span>
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

      {open && (
        <div className="date-pop" role="dialog" aria-label="选择日期">
          <div className="date-pop-head">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              aria-label="上个月"
              className="date-nav"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="date-pop-title">
              {view.y} 年 {view.m + 1} 月
            </span>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              aria-label="下个月"
              className="date-nav"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>

          <div className="date-week">
            {WEEK.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="date-grid">
            {cells.map((d, i) => {
              if (d === null) return <span key={i} />;
              const ymd = toYMD(new Date(view.y, view.m, d));
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(ymd);
                    setOpen(false);
                  }}
                  className={`date-day ${ymd === value ? "date-day-sel" : ""} ${
                    ymd === today ? "date-day-today" : ""
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
