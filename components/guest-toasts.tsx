"use client";

import { useEffect, useState } from "react";
import {
  GUEST_EXPIRY_EVENT,
  GUEST_EXPIRY_KEY,
  GUEST_WELCOME_KEY,
  readGuestExpiry,
  rememberGuestExpiry,
  removeGuestExpiry,
} from "@/lib/guest-session-client";

/**
 * 访客提示卡三件套 —— 与「访客验证码」提示同款视觉：
 * 磨砂玻璃卡片（rgba(240,240,245,0.95) + saturate(180%) blur(22px)），
 * 高 56px、顶部居中、无左侧竖条、无关闭按钮、自动消失（10s）。
 * 仅圆角从胶囊的 28 改为圆角矩形 16（用户认可的形态）。
 *
 * - GuestToasts（挂在根布局）：登录成功欢迎卡 + 会话到期提示卡
 * - GuestSessionWatcher：把服务端权威到期时间同步给根级守望器
 * - GuestToasts：所有页面共用一个计时器，到期前提醒，到点销毁并退出
 */

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
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    let nextWelcome: number | null = null;
    let nextExpired = false;
    // 欢迎卡：游客登录成功整页跳转前落的标记，落到 /home 后展示。
    // 只在 /home 路径下展示：Safari cookie 时序下跳转可能被 307 弹回登录页，
    // 此时静默丢弃标记，避免「提示登录成功人却还在登录页」的误导。
    try {
      const raw = sessionStorage.getItem(GUEST_WELCOME_KEY);
      if (raw) {
        sessionStorage.removeItem(GUEST_WELCOME_KEY);
        if (window.location.pathname.startsWith("/home")) {
          const n = Number(raw);
          nextWelcome = Number.isFinite(n) && n > 0 ? n : 60;
        }
      }
    } catch {
      /* 无痕等场景静默忽略 */
    }
    // 到期卡：被强制退出回登录页时带上的参数，读完即清（刷新不重复弹）
    const params = new URLSearchParams(window.location.search);
    if (params.get("guestExpired") === "1") {
      removeGuestExpiry();
      params.delete("guestExpired");
      const rest = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${rest ? `?${rest}` : ""}`,
      );
      nextExpired = true;
    }
    const timer = window.setTimeout(() => {
      if (nextWelcome !== null) setWelcomeTtl(nextWelcome);
      if (nextExpired) setShowExpired(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 根级绝对过期计时器。localStorage 让刷新、新标签页与路由切换都不丢失；
  // 它只用于前端提醒，真正授权仍由服务端 guest_sessions.expires_at 决定。
  useEffect(() => {
    let ended = false;
    let timers: ReturnType<typeof setTimeout>[] = [];

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    async function endSession() {
      if (ended) return;
      ended = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch("/api/auth/end-session", {
          method: "POST",
          signal: controller.signal,
        });
        if (response.ok) removeGuestExpiry();
      } catch {
        // 仍跳转：下一个服务端页面请求会再次执行绝对过期销毁。
      } finally {
        window.clearTimeout(timeout);
      }
      // Full navigation makes the next server request enforce expiry again if
      // the cleanup request was interrupted while the device was waking up.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/?guestExpired=1");
    }

    function schedule() {
      clearTimers();
      setShowWarning(false);
      const raw = readGuestExpiry();
      if (!raw) return;
      const end = new Date(raw).getTime();
      if (!Number.isFinite(end)) {
        removeGuestExpiry();
        return;
      }
      const now = Date.now();
      const warnAt = end - WARN_BEFORE_MS;
      if (now >= end) {
        void endSession();
        return;
      }
      if (now >= warnAt) {
        setShowWarning(true);
      } else {
        timers.push(
          setTimeout(() => setShowWarning(true), warnAt - now),
        );
      }
      timers.push(setTimeout(() => void endSession(), end - now));
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === GUEST_EXPIRY_KEY) schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    window.addEventListener(GUEST_EXPIRY_EVENT, schedule);
    return () => {
      clearTimers();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(GUEST_EXPIRY_EVENT, schedule);
    };
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

  useEffect(() => {
    if (!showWarning) return;
    const timer = setTimeout(() => setShowWarning(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [showWarning]);

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
          subColor: "#6e6e73",
        }}
      />
    );
  }
  if (showWarning) {
    return (
      <Card
        variant={{
          icon: <ClockIcon />,
          title: "访客会话即将结束",
          sub: "5 分钟后自动退出",
          subColor: "#ff3b30",
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
  useEffect(() => {
    const end = new Date(expiresAt).getTime();
    if (!Number.isFinite(end)) return;
    rememberGuestExpiry(expiresAt);
  }, [expiresAt]);
  return null;
}
