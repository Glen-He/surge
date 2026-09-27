import type { ReactNode } from "react";

// 统一卡片 Header：40px 图标 + 卡片标题档位 + 辅助说明档位；extra 放标题右侧的小操作（如 ⓘ）
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
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-sunken)] text-[var(--text-primary)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="type-card-title text-[var(--text-primary)]">
            {title}
          </h2>
          {extra}
        </div>
        <p className="mt-1 type-caption text-[var(--text-secondary)]">{desc}</p>
      </div>
    </div>
  );
}
