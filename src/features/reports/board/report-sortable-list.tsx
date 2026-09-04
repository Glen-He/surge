"use client";

import {
  Accessibility,
  AutoScroller,
  Feedback,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import {
  DragDropProvider,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { EmptyState } from "@/features/reports/board/empty-state";
import {
  applyReportOrder,
  moveReportToDateIndex,
  reportDate,
  reportOrderItems,
  sameReportOrder,
  type ReportOrderItem,
} from "@/features/reports/board/report-drag-layout";
import { ReportTouchSensor } from "@/features/reports/board/report-touch-sensor";
import type { ReportCardView as Report } from "@/features/reports/data/report-cards";

const REPORT_REORDER_ERROR_KEY = "surge:report-reorder-error";
const REPORT_MOTION_DURATION_MS = 260;
const REPORT_MOTION_EASING = "cubic-bezier(0.25, 1, 0.5, 1)";

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${year} 年 ${parseInt(month, 10)} 月`;
}

export type SortableReportCardOptions = {
  activeSession: boolean;
  canDrag: boolean;
  dragActivatorRef?: (element: HTMLElement | null) => void;
  suppressHover: boolean;
};

type RenderCard = (
  report: Report,
  options: SortableReportCardOptions,
) => ReactNode;

type DayGroup = { key: string; items: Report[] };
type MonthGroup = { key: string; days: DayGroup[] };
type SuppressedHover = {
  slug: string;
  x: number;
  y: number;
} | null;

function mouseReleasePoint(event: DragEndEvent): { x: number; y: number } | null {
  const activator = event.operation.activatorEvent;
  const release = event.nativeEvent;
  if (
    typeof PointerEvent === "undefined" ||
    !(activator instanceof PointerEvent) ||
    activator.pointerType !== "mouse" ||
    !(release instanceof PointerEvent)
  ) {
    return null;
  }
  return { x: release.clientX, y: release.clientY };
}

function groupReports(items: Report[]): MonthGroup[] {
  const months = new Map<string, MonthGroup>();
  for (const item of items) {
    const date = reportDate(item);
    const monthKey = date.slice(0, 7);
    const month = months.get(monthKey) ?? { key: monthKey, days: [] };
    let day = month.days.at(-1);
    if (!day || day.key !== date) {
      day = { key: date, items: [] };
      month.days.push(day);
    }
    day.items.push(item);
    months.set(monthKey, month);
  }
  return [...months.values()];
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

function SortableReportCard({
  report,
  date,
  index,
  activeSession,
  canDrag,
  suppressHover,
  clearSuppressedHover,
  reducedMotion,
  renderCard,
}: {
  report: Report;
  date: string;
  index: number;
  activeSession: boolean;
  canDrag: boolean;
  suppressHover: boolean;
  clearSuppressedHover: () => void;
  reducedMotion: boolean;
  renderCard: RenderCard;
}) {
  const {
    ref,
    handleRef,
    sortable,
    isDragSource,
    isDragging,
    isDropping,
  } = useSortable({
    id: report.slug,
    index,
    group: date,
    type: "report",
    accept: "report",
    data: { slug: report.slug, title: report.title },
    disabled: !canDrag,
    transition: reducedMotion
      ? null
      : {
          duration: REPORT_MOTION_DURATION_MS,
          easing: REPORT_MOTION_EASING,
        },
  });
  const projectedDate = isDragSource && sortable.group
    ? String(sortable.group)
    : date;
  const displayReport = projectedDate === reportDate(report)
    ? report
    : { ...report, date: projectedDate };

  return (
    <div
      ref={ref}
      data-report-dnd-slug={report.slug}
      data-report-card-date={projectedDate}
      data-report-hover-suppressed={suppressHover ? "true" : undefined}
      onPointerLeave={suppressHover ? clearSuppressedHover : undefined}
      className={`relative mb-5 rounded-[18px] will-change-transform ${
        isDragging || isDropping ? "z-50" : "z-0"
      }`}
    >
      {renderCard(displayReport, {
        activeSession,
        canDrag,
        dragActivatorRef: canDrag ? handleRef : undefined,
        suppressHover,
      })}
    </div>
  );
}

function ReportDayBoundary({
  date,
  separated,
}: {
  date: string;
  separated: boolean;
}) {
  const { ref } = useDroppable({
    id: date,
    type: "day",
    accept: "report",
    collisionPriority: -1,
    data: { date },
  });

  if (!separated) {
    return (
      <div
        ref={ref}
        data-report-day={date}
        className="col-span-full h-0"
      />
    );
  }

  return (
    <div
      ref={ref}
      data-report-day={date}
      className="col-span-full mb-5 flex h-1 items-center justify-center gap-3"
    >
      <span className="h-px w-16 bg-[rgba(0,0,0,0.06)]" />
      <span className="h-1 w-1 rounded-full bg-[#c7c7cc]" />
      <span className="h-px w-16 bg-[rgba(0,0,0,0.06)]" />
    </div>
  );
}

function orderFromResponse(value: unknown): ReportOrderItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: ReportOrderItem[] = [];
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as Record<string, unknown>).slug !== "string" ||
      typeof (entry as Record<string, unknown>).date !== "string"
    ) {
      return null;
    }
    items.push({
      slug: (entry as { slug: string }).slug,
      date: (entry as { date: string }).date,
    });
  }
  return items;
}

export function SortableReportList({
  reports,
  q,
  renderCard,
}: {
  reports: Report[];
  q: string;
  renderCard: RenderCard;
}): ReactNode {
  const [committedItems, setCommittedItems] = useState(reports);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [suppressedHover, setSuppressedHover] =
    useState<SuppressedHover>(null);
  const committedRef = useRef(reports);
  const serverItemsRef = useRef(reports);
  const dragSnapshotRef = useRef<Report[] | null>(null);
  const pendingSaveRef = useRef<Report[] | null>(null);
  const savingRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const commitFrameRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    try {
      if (sessionStorage.getItem(REPORT_REORDER_ERROR_KEY) !== "1") return;
      sessionStorage.removeItem(REPORT_REORDER_ERROR_KEY);
      toast.error("排序保存失败，已重新同步项目顺序");
    } catch {
      // sessionStorage 不可用时不影响项目列表渲染。
    }
  }, []);

  useEffect(() => {
    return () => {
      if (commitFrameRef.current !== null) {
        cancelAnimationFrame(commitFrameRef.current);
      }
    };
  }, []);

  const canDrag = q.trim() === "";
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return committedItems;
    return committedItems.filter((report) => {
      const haystack = [
        report.title,
        report.desc,
        report.tag,
        report.date,
        ...report.keywords,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [committedItems, q]);
  const groups = useMemo(() => groupReports(list), [list]);

  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        preventActivation(event, source) {
          if (event.pointerType === "touch") return true;
          return PointerSensor.defaults.preventActivation?.(event, source) ?? false;
        },
        activationConstraints(event) {
          return event.pointerType === "touch"
            ? [
                new PointerActivationConstraints.Delay({
                  value: 200,
                  tolerance: 6,
                }),
              ]
            : [new PointerActivationConstraints.Distance({ value: 7 })];
        },
      }),
      ReportTouchSensor.configure({ delay: 250, tolerance: 8 }),
      KeyboardSensor.configure({
        keyboardCodes: {
          start: ["Space"],
          cancel: ["Escape"],
          end: ["Space"],
          up: ["ArrowUp"],
          down: ["ArrowDown"],
          left: ["ArrowLeft"],
          right: ["ArrowRight"],
        },
      }),
    ],
    [],
  );

  const announcements = useMemo(
    () => ({
      dragstart({ operation: { source } }: DragStartEvent) {
        if (!source) return undefined;
        const report = committedRef.current.find(
          (item) => item.slug === String(source.id),
        );
        return report
          ? `已拿起“${report.title}”。使用方向键移动，空格键放下，Esc 键取消。`
          : undefined;
      },
      dragover({ operation: { source } }: DragStartEvent) {
        if (!source || !isSortable(source)) return undefined;
        const report = committedRef.current.find(
          (item) => item.slug === String(source.id),
        );
        return report
          ? `“${report.title}”当前位于 ${String(source.group)} 第 ${source.index + 1} 位。`
          : undefined;
      },
      dragend({ operation: { source }, canceled }: DragEndEvent) {
        if (canceled) return "已取消移动，项目回到原位置。";
        return source ? "项目顺序已更新。" : undefined;
      },
    }),
    [],
  );

  async function flushSaves() {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      while (pendingSaveRef.current) {
        const target = pendingSaveRef.current;
        pendingSaveRef.current = null;
        const base = serverItemsRef.current;
        try {
          const response = await fetch("/api/reports/reorder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseItems: reportOrderItems(base),
              items: reportOrderItems(target),
            }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            const canonicalOrder = orderFromResponse(data?.items);
            const canonical = canonicalOrder
              ? applyReportOrder(committedRef.current, canonicalOrder)
              : null;
            if (canonical) {
              pendingSaveRef.current = null;
              serverItemsRef.current = canonical;
              committedRef.current = canonical;
              setCommittedItems(canonical);
            }
            throw new Error("reorder request rejected");
          }
          serverItemsRef.current = target;
        } catch {
          pendingSaveRef.current = null;
          try {
            sessionStorage.setItem(REPORT_REORDER_ERROR_KEY, "1");
          } catch {
            // 无痕模式拒绝 sessionStorage 时仍继续刷新并恢复服务器顺序。
          }
          window.location.reload();
          return;
        }
      }
    } finally {
      savingRef.current = false;
    }
  }

  function queueSave(next: Report[]) {
    pendingSaveRef.current = next;
    void flushSaves();
  }

  function handleDragStart(event: DragStartEvent) {
    const source = event.operation.source;
    if (!source) return;
    if (commitFrameRef.current !== null) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    setSuppressedHover(null);
    dragSnapshotRef.current = committedRef.current;
    setActiveSlug(String(source.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const source = event.operation.source;
    const snapshot = dragSnapshotRef.current;
    const releasePoint = !event.canceled && source
      ? mouseReleasePoint(event)
      : null;
    setSuppressedHover(
      releasePoint && source
        ? { slug: String(source.id), ...releasePoint }
        : null,
    );
    suppressClickUntilRef.current = performance.now() + 500;
    if (!source || !snapshot || !isSortable(source)) {
      dragSnapshotRef.current = null;
      setActiveSlug(null);
      return;
    }

    const next = event.canceled
      ? snapshot
      : moveReportToDateIndex(
          snapshot,
          String(source.id),
          String(source.group),
          source.index,
        );
    const waitForDomOwnership = () => {
      if (source.status !== "idle") {
        commitFrameRef.current = requestAnimationFrame(waitForDomOwnership);
        return;
      }
      commitFrameRef.current = null;
      dragSnapshotRef.current = null;
      setActiveSlug(null);
      if (event.canceled || sameReportOrder(snapshot, next)) return;
      committedRef.current = next;
      setCommittedItems(next);
      queueSave(next);
    };
    commitFrameRef.current = requestAnimationFrame(waitForDomOwnership);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!suppressedHover || event.pointerType !== "mouse") return;
    const dx = event.clientX - suppressedHover.x;
    const dy = event.clientY - suppressedHover.y;
    if (dx * dx + dy * dy >= 9) {
      setSuppressedHover(null);
    }
  }

  return (
    <div className="mt-16">
      {list.length === 0 ? (
        <EmptyState
          icon="search"
          title="没有找到匹配的报告"
          hint="试试其他关键词或分类"
        />
      ) : null}

      <DragDropProvider
        sensors={sensors}
        plugins={(defaults) => [
          ...defaults,
          Accessibility.configure({
            announcements,
            screenReaderInstructions: {
              draggable:
                "在项目卡片上按空格键开始移动，使用方向键选择位置，再按空格键放下；按 Esc 键取消。",
            },
          }),
          AutoScroller.configure({
            acceleration: 12,
            threshold: { x: 0.12, y: 0.14 },
          }),
          Feedback.configure({
            dropAnimation: reducedMotion
              ? null
              : {
                  duration: REPORT_MOTION_DURATION_MS,
                  easing: REPORT_MOTION_EASING,
                },
            keyboardTransition: reducedMotion
              ? null
              : {
                  duration: REPORT_MOTION_DURATION_MS,
                  easing: REPORT_MOTION_EASING,
                },
          }),
        ]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          onPointerMoveCapture={handlePointerMove}
          onClickCapture={(event) => {
            if (performance.now() < suppressClickUntilRef.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          className={`grid grid-cols-1 gap-x-5 md:grid-cols-2 lg:grid-cols-3 ${
            activeSlug ? "select-none" : ""
          }`}
        >
          {groups.flatMap((month, monthIndex) => [
            <h3
              key={`month:${month.key}`}
              className={`col-span-full mb-10 flex items-center gap-3 text-[15px] font-medium text-[#6e6e73] ${
                monthIndex > 0 ? "mt-5" : ""
              }`}
            >
              {monthLabel(month.key)}
              <span className="text-[13px] font-medium text-[#a1a1a6]">
                {month.days.reduce(
                  (count, day) => count + day.items.length,
                  0,
                )}{" "}
                份
              </span>
              <span className="h-px flex-1 bg-[rgba(0,0,0,0.08)]" />
            </h3>,
            ...month.days.flatMap((day, dayIndex) => [
              <ReportDayBoundary
                key={`day:${day.key}`}
                date={day.key}
                separated={dayIndex > 0}
              />,
              ...day.items.map((report, index) => (
                <SortableReportCard
                  key={report.slug}
                  report={report}
                  date={day.key}
                  index={index}
                  activeSession={activeSlug !== null}
                  canDrag={canDrag}
                  suppressHover={suppressedHover?.slug === report.slug}
                  clearSuppressedHover={() => setSuppressedHover(null)}
                  reducedMotion={reducedMotion}
                  renderCard={renderCard}
                />
              )),
            ]),
          ])}
        </div>
      </DragDropProvider>
    </div>
  );
}
