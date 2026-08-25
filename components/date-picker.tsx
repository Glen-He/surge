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
  const [picker, setPicker] = useState<"days" | "years">("days");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initial = parseYMD(value) ?? new Date();
  const [view, setView] = useState({
    y: initial.getFullYear(),
    m: initial.getMonth(),
  });

  // 打开时同步到当前值所在月份，并回到日期视图
  useEffect(() => {
    if (!open) return;
    const d = parseYMD(value) ?? new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setPicker("days");
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

  // 年份视图：一次展示 12 年，箭头整组翻页（跨年无需逐月点）
  const yearPage = Math.floor(view.y / 12) * 12;
  const years = Array.from({ length: 12 }, (_, i) => yearPage + i);
  const selectedYear = initial.getFullYear();

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
            </>
          ) : (
            <div className="date-year-grid">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setView((v) => ({ ...v, y }));
                    setPicker("days");
                  }}
                  className={`date-year ${y === selectedYear ? "date-year-sel" : ""}`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
