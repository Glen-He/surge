"use client";

import { Fragment } from "react";

/**
 * 轻量步骤指示器：24px 圆点 + 13px 文字 + 细连接线。
 * current 之前的步骤显示蓝色对勾，current 为蓝色数字，之后为浅灰。
 */
export function StepIndicator({
  steps,
  current,
}: {
  steps: string[];
  /** 当前步骤下标；等于 steps.length 时表示全部完成 */
  current: number;
}) {
  return (
    <div className="step-indicator">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <Fragment key={label}>
            {i > 0 && (
              <span
                className={`step-line ${i <= current ? "step-line-done" : ""}`}
                aria-hidden="true"
              />
            )}
            <span className="step-item">
              <span className={`step-dot step-dot-${state}`} aria-hidden="true">
                {state === "done" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="h-[12px] w-[12px]"
                  >
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`step-label step-label-${state}`}>{label}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
