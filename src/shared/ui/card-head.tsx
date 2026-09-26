import type { ReactNode } from "react";

// 统一卡片 Header：40px 图标 + 18px 标题 + 14px 说明；extra 放标题右侧的小操作（如 ⓘ）
export function CardHead({
  icon,
  title,
  desc,
  extra,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  extra?: ReactNode;
}) {
  return (
    <div className="card-head">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[var(--surface-sunken)] text-[var(--text-primary)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[18px] font-semibold leading-[1.3] text-[var(--text-primary)]">
            {title}
          </h2>
          {extra}
        </div>
        <p className="mt-1 text-[14px] leading-[1.5] text-[var(--text-secondary)]">{desc}</p>
      </div>
    </div>
  );
}
