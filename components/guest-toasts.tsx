"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 访客提示卡三件套 —— 与「访客验证码」提示同款视觉：
 * 磨砂玻璃卡片（rgba(240,240,245,0.95) + saturate(180%) blur(22px)），
 * 高 56px、顶部居中、无左侧竖条、无关闭按钮、自动消失（10s）。
 * 仅圆角从胶囊的 28 改为圆角矩形 16（用户认可的形态）。
 *
 * - GuestToasts（挂在根布局）：登录成功欢迎卡 + 会话到期提示卡
 * - GuestSessionWatcher（挂在 /home 与报告查看页）：
 *     到期前 5 分钟「即将结束」提醒；到点调 end-session 销毁并跳登录页
 */

const WELCOME_KEY = "surge:guest-login-toast";
const WARN_BEFORE_MS = 5 * 60 * 1000; // 到期前 5 分钟提醒
const AUTO_DISMISS_MS = 10_000; // 驻留 10 秒

type Variant = {
  icon: React.ReactNode;
  title: string;
  sub: string;
  subColor: string;
};

function Card({ variant }: { variant: Variant }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      aria-live="polite"
      className={[
        "pointer-events-none fixed left-1/2 top-6 z-[120] -translate-x-1/2",
        "transition-all duration-300 ease-out",
        mounted ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0",
      ].join(" ")}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 56,
          padding: "0 20px",
          borderRadius: 16,
          background: "rgba(240, 240, 245, 0.95)",
          backdropFilter: "saturate(180%) blur(22px)",
          WebkitBackdropFilter: "saturate(180%) blur(22px)",
          boxShadow:
            "0 10px 30px rgba(0, 0, 0, 0.10), 0 1px 3px rgba(0, 0, 0, 0.05)",
          width: "fit-content",
          maxWidth: "calc(100vw - 48px)",
        }}
      >
        {variant.icon}
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#1d1d1f",
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {variant.title}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: variant.subColor,
            whiteSpace: "nowrap",
          }}
        >
          {variant.sub}
        </span>
      </div>
    </div>
  );
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0071E3"
      strokeWidth={1.8}
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF9500"
      strokeWidth={1.8}
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

/** 根布局挂载：欢迎卡（sessionStorage 标记）+ 到期卡（?guestExpired=1） */
export function GuestToasts() {
  const [welcomeTtl, setWelcomeTtl] = useState<number | null>(null);
  const [showExpired, setShowExpired] = useState(false);

  useEffect(() => {
    // 欢迎卡：游客登录成功整页跳转前落的标记，落到 /home 后展示。
    // 只在 /home 路径下展示：Safari cookie 时序下跳转可能被 307 弹回登录页，
    // 此时静默丢弃标记，避免「提示登录成功人却还在登录页」的误导。
    try {
      const raw = sessionStorage.getItem(WELCOME_KEY);
      if (raw) {
        sessionStorage.removeItem(WELCOME_KEY);
        if (window.location.pathname.startsWith("/home")) {
          const n = Number(raw);
          setWelcomeTtl(Number.isFinite(n) && n > 0 ? n : 60);
        }
      }
    } catch {
      /* 无痕等场景静默忽略 */
    }
    // 到期卡：被强制退出回登录页时带上的参数，读完即清（刷新不重复弹）
    const params = new URLSearchParams(window.location.search);
    if (params.get("guestExpired") === "1") {
      params.delete("guestExpired");
      const rest = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${rest ? `?${rest}` : ""}`,
      );
      setShowExpired(true);
    }
  }, []);

  useEffect(() => {
    if (welcomeTtl === null) return;
    const t = setTimeout(() => setWelcomeTtl(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [welcomeTtl]);

  useEffect(() => {
    if (!showExpired) return;
    const t = setTimeout(() => setShowExpired(false), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [showExpired]);

  if (welcomeTtl !== null) {
    return (
      <Card
        variant={{
          icon: <PersonIcon />,
          title: "访客登录成功",
          sub: `会话 ${welcomeTtl} 分钟`,
          subColor: "#0071E3",
        }}
      />
    );
  }
  if (showExpired) {
    return (
      <Card
        variant={{
          icon: <ClockIcon />,
          title: "访客体验已结束",
          sub: "注册账号可长期保存汇报",
          subColor: "#C77700",
        }}
      />
    );
  }
  return null;
}

/**
 * 访客会话守望器（服务端渲染进页面，仅访客会话渲染）：
 * - 剩余 ≤5 分钟：弹「即将结束」提醒卡（10 秒自动消失）
 * - 到点：POST end-session（销毁访客沙箱 + 清 cookie）→ 跳 /?guestExpired=1
 *   （登录页的 GuestToasts 再展示「访客体验已结束」卡）
 * - visibilitychange：合盖/休眠回来后立即复查，过期即走退出流程
 */
export function GuestSessionWatcher({ expiresAt }: { expiresAt: string }) {
  const [warn, setWarn] = useState(false);
  const endedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const end = new Date(expiresAt).getTime();
    if (!Number.isFinite(end)) return;
    const warnAt = end - WARN_BEFORE_MS;

    async function endSession() {
      if (endedRef.current) return;
      endedRef.current = true;
      try {
        await fetch("/api/auth/end-session", { method: "POST" });
      } catch {
        /* 网络失败也照样跳，服务端页面级拦截会兜底 */
      }
      window.location.assign("/?guestExpired=1");
    }

    function schedule() {
      const now = Date.now();
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      if (now >= end) {
        void endSession();
        return;
      }
      if (now >= warnAt) {
        setWarn(true);
      } else {
        timersRef.current.push(
          setTimeout(() => setWarn(true), warnAt - now),
        );
      }
      timersRef.current.push(setTimeout(() => void endSession(), end - now));
    }

    schedule();
    const onVis = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [expiresAt]);

  useEffect(() => {
    if (!warn) return;
    const t = setTimeout(() => setWarn(false), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [warn]);

  if (!warn) return null;
  return (
    <Card
      variant={{
        icon: <ClockIcon />,
        title: "访客会话即将结束",
        sub: "5 分钟后自动退出",
        subColor: "#C77700",
      }}
    />
  );
}
