"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/modal";
import { StepIndicator } from "@/components/step-indicator";
import { showGuestOtpFromResponse } from "@/lib/guest-otp-store";
import {
  PASSWORD_RULE_TEXT,
  passwordPolicyError,
} from "@/lib/password-policy";
import { applyOtpRetry, useOtpCooldown } from "@/components/use-otp-cooldown";

// 状态机：选择方式 → 验证（密码 / 邮箱验证码）→ 设置新密码 → 完成
type Mode = "select" | "password" | "otp" | "new-password" | "success";

const STEPS = ["选择验证方式", "设置新密码", "完成"];

// 轻量强度评估：弱 / 一般 / 强
function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return 1;
  if (score <= 3) return 2;
  return 3;
}

const STRENGTH_META = {
  1: { label: "弱", color: "#ff3b30" },
  2: { label: "一般", color: "#ff9500" },
  3: { label: "强", color: "#34c759" },
} as const;

const ICON_LOCK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="h-[18px] w-[18px]"
  >
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

const ICON_MAIL = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="h-[18px] w-[18px]"
  >
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

function EyeToggle({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "隐藏密码" : "显示密码"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] transition-colors hover:text-[#1d1d1f]"
    >
      {shown ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-5 w-5"
        >
          <path d="M3 3l18 18" />
          <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
          <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c5.5 0 9 7 9 7a17 17 0 0 1-2.6 3.2M6.6 6.6A17 17 0 0 0 3 12s3.5 7 9 7a9.7 9.7 0 0 0 4-.9" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-5 w-5"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}

function BackLink({
  onClick,
  label = "返回选择方式",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button type="button" onClick={onClick} className="modal-back mb-4">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-4 w-4"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </button>
  );
}

export function PasswordChangeModal({
  open,
  onClose,
  currentEmail,
}: {
  open: boolean;
  onClose: () => void;
  currentEmail: string;
}) {
  if (!open) return null;
  return (
    <PasswordChangeDialog onClose={onClose} currentEmail={currentEmail} />
  );
}

function PasswordChangeDialog({
  onClose,
  currentEmail,
}: {
  onClose: () => void;
  currentEmail: string;
}) {
  const [mode, setMode] = useState<Mode>("select");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const [otp, setOtp] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [cooldown, setCooldown] = useOtpCooldown();
  // 每日上限（自然日 10 次）：按钮静态禁用显示"明日再试"，不跑秒级倒计时
  const [dailyLimit, setDailyLimit] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newShow, setNewShow] = useState(false);
  const [confirmShow, setConfirmShow] = useState(false);
  const [newPasswordError, setNewPasswordError] = useState("");

  const [passwordChangeToken, setPasswordChangeToken] = useState("");
  const closeTimer = useRef<number | null>(null);
  const otpRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // ── 发送邮箱验证码 ──
  async function sendOtp() {
    if (otpSending) return;
    setMsg(null);
    setOtpSending(true);
    try {
      const res = await fetch("/api/account/password/send-otp", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "发送失败" });
        applyOtpRetry(data, setDailyLimit, setCooldown);
        return;
      }
      applyOtpRetry(data, setDailyLimit, setCooldown, 60);
      // 游客模式：响应体直接携带验证码，立即显示（事件驱动，无轮询）
      showGuestOtpFromResponse(data);
      otpRef.current?.focus({ preventScroll: true });
    } finally {
      setOtpSending(false);
    }
  }

  function onVerified(token: string) {
    setPasswordChangeToken(token);
    setMsg(null);
    setMode("new-password");
  }

  // ── 方式一：当前密码验证 ──
  async function verifyByPassword() {
    if (loading) return;
    setPasswordError("");
    setMsg(null);
    if (!currentPassword) {
      setPasswordError("请输入当前密码");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/account/password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "password", password: currentPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPasswordError(data.error ?? "当前密码错误");
        return;
      }
      onVerified(data.passwordChangeToken);
    } finally {
      setLoading(false);
    }
  }

  // ── 方式二：邮箱验证码（输满 6 位自动验证）──
  async function verifyByOtp(otpValue: string) {
    if (otpValue.length !== 6 || loading) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "otp", otp: otpValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtp("");
        setMsg({ ok: false, text: data.error ?? "验证失败" });
        return;
      }
      onVerified(data.passwordChangeToken);
    } finally {
      setLoading(false);
    }
  }

  // ── 提交新密码 ──
  async function submitNewPassword() {
    if (loading) return;
    setNewPasswordError("");
    setMsg(null);
    const pwdError = passwordPolicyError(newPassword);
    if (pwdError) {
      setNewPasswordError(pwdError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setNewPasswordError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/account/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordChangeToken, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNewPasswordError(data.error ?? "修改失败");
        return;
      }
      setMode("success");
      closeTimer.current = window.setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1600);
    } finally {
      setLoading(false);
    }
  }

  const strength = passwordStrength(newPassword);
  const strengthMeta = strength === 0 ? null : STRENGTH_META[strength];
  const busy = loading || otpSending;
  const dirty =
    mode !== "success" && (newPassword !== "" || confirmPassword !== "");

  return (
    <Modal
      open
      onClose={onClose}
      title="修改密码"
      busy={busy}
      dirty={dirty}
      plainHeader
    >
      {mode === "select" && (
        <div key="select" className="animate-step">
          <StepIndicator steps={STEPS} current={0} />

          <p className="text-[16px] font-semibold text-[#1d1d1f]">
            选择身份验证方式
          </p>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#6e6e73]">
            为了保护账号安全，请先确认是你本人。
          </p>

          <div className="verify-methods mt-4">
            <button
              type="button"
              onClick={() => setMode("password")}
              className="verify-method"
            >
              <span className="verify-method-icon">{ICON_LOCK}</span>
              <span className="text-[15px] font-medium text-[#1d1d1f]">
                当前密码
              </span>
              <span className="mt-0.5 text-[13px] leading-snug text-[#6e6e73]">
                使用登录密码验证
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("otp")}
              className="verify-method"
            >
              <span className="verify-method-icon">{ICON_MAIL}</span>
              <span className="text-[15px] font-medium text-[#1d1d1f]">
                邮箱验证码
              </span>
              <span className="break-email mt-0.5 text-[13px] leading-snug text-[#6e6e73]">
                发送至 {currentEmail}
              </span>
            </button>
          </div>
        </div>
      )}

      {mode === "password" && (
        <div key="password" className="animate-step">
          <BackLink onClick={() => setMode("select")} />

          <p className="text-[16px] font-semibold text-[#1d1d1f]">
            验证当前密码
          </p>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#6e6e73]">
            请输入当前登录密码以继续。
          </p>

          <label className="mb-2 mt-4 block text-[14px] font-medium text-[#1d1d1f]">
            当前密码
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setPasswordError("");
              }}
              autoComplete="current-password"
              className={`input pr-12 ${passwordError ? "input-error" : ""}`}
            />
            <EyeToggle
              shown={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </div>
          <p className="field-error">{passwordError}</p>
          <Link href="/forgot" className="modal-back mt-2.5">
            忘记密码？
          </Link>

          <div className="modal-actions">
            <button
              type="button"
              onClick={verifyByPassword}
              disabled={loading || !currentPassword}
              className="btn-primary"
            >
              {loading ? "验证中…" : "验证身份"}
            </button>
          </div>
        </div>
      )}

      {mode === "otp" && (
        <div key="otp" className="animate-step">
          <BackLink onClick={() => setMode("select")} />

          <p className="text-[16px] font-semibold text-[#1d1d1f]">验证邮箱</p>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#6e6e73]">
            验证码将发送至{" "}
            <span className="break-email font-medium text-[#1d1d1f]">
              {currentEmail}
            </span>
          </p>

          {/* 单行：验证码输入 + 获取验证码，输满 6 位自动验证 */}
          <div className="mt-4 flex items-center gap-2.5">
            <input
              ref={otpRef}
              value={otp}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOtp(v);
                setMsg(null);
                if (v.length === 6) void verifyByOtp(v);
              }}
              placeholder="输入验证码"
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={loading}
              className="h-[44px] min-w-0 flex-1 rounded-full border border-[rgba(0,0,0,0.12)] bg-white px-4 text-center text-[16px] tracking-[0.25em] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
            />
            <button
              type="button"
              onClick={sendOtp}
              disabled={otpSending || cooldown > 0 || dailyLimit || loading}
              className="btn-primary otp-send"
            >
              {otpSending
                ? "发送中…"
                : dailyLimit
                  ? "明日再试"
                  : cooldown > 0
                    ? `${cooldown}s 后重发`
                    : "获取验证码"}
            </button>
          </div>
          <p className="mt-2 text-[13px] text-[#6e6e73]">
            验证码 6 位数字，输入后自动验证，5 分钟内有效
          </p>
          <p className="field-error">{msg && !msg.ok ? msg.text : ""}</p>
          <p className="mt-2 h-[18px] text-[13px] leading-[18px] text-[#6e6e73]">
            {loading ? "验证中…" : ""}
          </p>
        </div>
      )}

      {mode === "new-password" && (
        <div key="new-password" className="animate-step">
          <BackLink
            onClick={() => {
              setMode("select");
              setPasswordChangeToken("");
            }}
          />
          <StepIndicator steps={STEPS} current={1} />

          <p className="text-[16px] font-semibold text-[#1d1d1f]">设置新密码</p>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#6e6e73]">
            请设置一个新的登录密码。
          </p>

          <label className="mb-2 mt-4 block text-[14px] font-medium text-[#1d1d1f]">
            新密码
          </label>
          <div className="relative">
            <input
              type={newShow ? "text" : "password"}
              placeholder={PASSWORD_RULE_TEXT}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setNewPasswordError("");
              }}
              autoComplete="new-password"
              className={`input pr-12 ${newPasswordError ? "input-error" : ""}`}
            />
            <EyeToggle shown={newShow} onToggle={() => setNewShow((v) => !v)} />
          </div>
          {strengthMeta && (
            <div className="pw-strength">
              <span className="pw-bars">
                {[1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="pw-bar"
                    style={
                      strengthMeta && i <= strength
                        ? { background: strengthMeta.color }
                        : undefined
                    }
                  />
                ))}
              </span>
              <span className="pw-strength-label">
                密码强度：{strengthMeta.label}
              </span>
            </div>
          )}

          <label className="mb-2 mt-4 block text-[14px] font-medium text-[#1d1d1f]">
            确认新密码
          </label>
          <div className="relative">
            <input
              type={confirmShow ? "text" : "password"}
              placeholder="请再次输入新密码"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setNewPasswordError("");
              }}
              autoComplete="new-password"
              className={`input pr-12 ${newPasswordError ? "input-error" : ""}`}
            />
            <EyeToggle
              shown={confirmShow}
              onToggle={() => setConfirmShow((v) => !v)}
            />
          </div>
          <p className="field-error">{newPasswordError}</p>

          <div className="modal-actions">
            <button
              type="button"
              onClick={submitNewPassword}
              disabled={loading || !newPassword || !confirmPassword}
              className="btn-primary"
            >
              {loading ? "保存中…" : "更新密码"}
            </button>
          </div>
        </div>
      )}

      {mode === "success" && (
        <div
          key="success"
          className="animate-step flex flex-col items-center py-4 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(52,199,89,0.12)]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#34c759"
              strokeWidth="2.5"
              className="h-7 w-7"
            >
              <path d="m5 13 4 4L19 7" />
            </svg>
          </div>
          <p className="mt-3 text-[17px] font-semibold text-[#1d1d1f]">
            密码已更新
          </p>
          <p className="mt-1.5 max-w-[280px] text-[14px] leading-relaxed text-[#6e6e73]">
            为了保护账号安全，其他设备的登录状态已失效。
          </p>
          <button
            type="button"
            onClick={() => {
              onClose();
              window.location.reload();
            }}
            className="btn-primary mt-5"
          >
            完成
          </button>
        </div>
      )}
    </Modal>
  );
}
