import type { ReactNode } from "react";

/** 顶部居中通知的统一容器，与游客模式提示共用同一视觉和进退场节奏。 */
export function TopNotice({
  children,
  mounted,
  interactive = false,
  className = "",
}: {
  children: ReactNode;
  mounted: boolean;
  interactive?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-live="polite"
      className="top-notice-host"
      data-mounted={mounted ? "true" : "false"}
    >
      <div
        className={`top-notice-card ${className}`.trim()}
        data-interactive={interactive ? "true" : "false"}
      >
        {children}
      </div>
    </div>
  );
}
