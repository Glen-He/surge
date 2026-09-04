import Link from "next/link";
import type { ReportCardView } from "@/features/reports/data/report-cards";
import { tagTextColor } from "@/features/reports/tag-colors";

/** 纯展示卡片：属主页和公开分享面板共用，公开端不会带入任何管理操作。 */
export function ReportCardLink({
  report,
  href,
  draggable = false,
  dragActivatorRef,
}: {
  report: ReportCardView;
  href: string;
  draggable?: boolean;
  dragActivatorRef?: (element: HTMLElement | null) => void;
}) {
  return (
    <Link
      ref={dragActivatorRef}
      href={href}
      draggable={false}
      role={draggable ? "link" : undefined}
      aria-roledescription={draggable ? "可排序项目" : undefined}
      className={`flex h-[208px] flex-col justify-between overflow-hidden rounded-[18px] border border-[rgba(0,0,0,0.055)] bg-[rgba(255,255,255,0.94)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.015),0_10px_30px_rgba(0,0,0,0.018)] transition-[box-shadow] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover/report-card:shadow-[0_8px_24px_rgba(0,0,0,0.06)] ${
        draggable
          ? "report-card-touch-activator cursor-grab active:cursor-grabbing"
          : ""
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <span
            className="rounded-full px-3 py-0.5 text-[11px] font-semibold"
            style={{
              backgroundColor: report.tagColor,
              color: tagTextColor(report.tagColor),
            }}
          >
            {report.tag}
          </span>
          <span className="whitespace-nowrap text-xs text-[#6e6e73] tabular-nums">
            {report.date}
          </span>
        </div>
        <h2 className="mt-2.5 line-clamp-2 text-[18px] font-semibold leading-[1.3] tracking-tight text-[#1d1d1f]">
          {report.title}
        </h2>
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-normal text-[#6e6e73]">
          {report.desc}
        </p>
      </div>
      <div className="mt-2 translate-y-1 text-xs font-semibold text-[#0071e3] opacity-0 transition-all group-hover/report-card:translate-y-0 group-hover/report-card:opacity-100 max-sm:translate-y-0 max-sm:opacity-100">
        查看报告
      </div>
    </Link>
  );
}
