"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error boundary captured an error", error);
  }, [error]);

  // 根布局也可能失效；这里保留与平台语义色一致的内联值，不依赖全局 CSS。
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <main
          style={{
            minHeight: "100svh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            boxSizing: "border-box",
            background: "#f5f5f7",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              padding: 32,
              boxSizing: "border-box",
              borderRadius: "var(--radius-xl, 22px)",
              background: "white",
              textAlign: "center",
              boxShadow: "0 12px 36px rgba(0,0,0,0.08)",
            }}
          >
            <h1 style={{ margin: 0, color: "#1d1d1f", fontSize: "var(--font-size-section-title, 20px)", lineHeight: "var(--line-height-section-title, 28px)", fontWeight: "var(--font-weight-semibold, 600)" }}>
              系统暂时不可用
            </h1>
            <p style={{ margin: "10px 0 0", color: "#6e6e73", fontSize: "var(--font-size-body, 14px)", lineHeight: "var(--line-height-body, 22px)", fontWeight: "var(--font-weight-regular, 400)" }}>
              请重试一次；如果问题持续存在，请稍后再访问。
            </p>
            {/* 静态 _global-error 的脚本没有 nonce，nonce CSP 下不会水合；
                使用真实链接保证未水合时也能重新加载，水合后再走 reset。 */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 错误页必须在无 JS 时也能导航 */}
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                reset();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 24,
                height: 40,
                padding: "0 22px",
                boxSizing: "border-box",
                border: 0,
                borderRadius: 999,
                background: "#1d1d1f",
                color: "white",
                fontSize: "var(--font-size-body, 14px)",
                lineHeight: "var(--line-height-body, 22px)",
                fontWeight: "var(--font-weight-medium, 500)",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              重新加载
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
