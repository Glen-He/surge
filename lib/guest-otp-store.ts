"use client";

/**
 * 游客验证码的轻量发布-订阅 store。
 *
 * 事件驱动架构：验证码显示的唯一入口是 showGuestOtpFromResponse() ——
 * 即"用户点击获取验证码 → 发送接口成功返回 → 响应体携带 guestOtp 字段"。
 * 没有任何轮询 / 后台拉取，全局挂载的 GuestOtpModal 只负责订阅渲染。
 */

export interface GuestOtpState {
  code: string;
  expiresAt: number;
}

type Listener = (s: GuestOtpState | null) => void;

const listeners: Set<Listener> = new Set();
let current: GuestOtpState | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribeGuestOtp(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function showGuestOtp(code: string, ttlSec = 600) {
  if (hideTimer) clearTimeout(hideTimer);
  current = {
    code,
    expiresAt: Date.now() + ttlSec * 1000,
  };
  listeners.forEach((l) => l(current));
  hideTimer = setTimeout(() => {
    current = null;
    listeners.forEach((l) => l(null));
  }, 5_000);
}

/** 从"发送验证码"接口的响应体中提取 guestOtp 并显示（非游客响应无此字段，静默跳过） */
export function showGuestOtpFromResponse(data: unknown) {
  const otp = (data as { guestOtp?: { code?: string; expiresIn?: number } })
    ?.guestOtp;
  if (otp?.code && /^\d{6}$/.test(otp.code)) {
    showGuestOtp(otp.code, typeof otp.expiresIn === "number" ? otp.expiresIn : 600);
  }
}

export function hideGuestOtp() {
  if (hideTimer) clearTimeout(hideTimer);
  current = null;
  listeners.forEach((l) => l(null));
}
