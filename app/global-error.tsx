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
    console.error(error);
  }, [error]);

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
              borderRadius: 24,
              background: "white",
              textAlign: "center",
              boxShadow: "0 12px 36px rgba(0,0,0,0.08)",
            }}
          >
            <h1 style={{ margin: 0, color: "#1d1d1f", fontSize: 22 }}>
              系统暂时不可用
            </h1>
            <p style={{ margin: "10px 0 0", color: "#6e6e73", fontSize: 14, lineHeight: 1.7 }}>
              请重试一次；如果问题持续存在，请稍后再访问。
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 24,
                height: 40,
                padding: "0 22px",
                border: 0,
                borderRadius: 999,
                background: "#1d1d1f",
                color: "white",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              重新加载
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
