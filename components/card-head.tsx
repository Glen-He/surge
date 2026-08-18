import type { ReactNode } from "react";

// 统一卡片 Header：40px 图标 + 18px 标题 + 14px 说明
export function CardHead({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="card-head">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[#f5f5f7] text-[#1d1d1f]">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold leading-[1.3] text-[#1d1d1f]">
          {title}
        </h2>
        <p className="mt-1 text-[14px] leading-[1.5] text-[#6e6e73]">{desc}</p>
      </div>
    </div>
  );
}
