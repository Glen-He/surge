import type { ReactNode } from "react";

/** 分享弹窗两个列表共用的加载/空状态占位，保持列表区域高度与边框一致。 */
export function ShareListPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-control)] type-caption text-[var(--text-secondary)]">
      {children}
    </div>
  );
}
