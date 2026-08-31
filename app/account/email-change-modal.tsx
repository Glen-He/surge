"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { StepIndicator } from "@/components/step-indicator";
import { showGuestOtpFromResponse } from "@/lib/guest-otp-store";
import { applyOtpRetry, useOtpCooldown } from "@/components/use-otp-cooldown";

// 状态机：UI 完全由 step 决定
type Step = "verify-current" | "enter-new" | "success";

const STEPS = ["验证邮箱", "新邮箱", "完成"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function BackLink({ onClick }: { onClick: () => void }) {
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
      返回上一步
    </button>
  );
}

export function EmailChangeModal({
  open,
  onClose,
  currentEmail,
}: {
  open: boolean;
  onClose: () => void;
  currentEmail: string;
}) {
  if (!open) return null;
  return <EmailChangeDialog onClose={onClose} currentEmail={currentEmail} />;
}

function EmailChangeDialog({
  onClose,
  currentEmail,
}: {
  onClose: () => void;
  currentEmail: string;
}) {
  const [step, setStep] = useState<Step>("verify-current");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Step1 当前邮箱验证码
  const [oldOtp, setOldOtp] = useState("");
  const [oldSending, setOldSending] = useState(false);
  const [oldCooldown, setOldCooldown] = useOtpCooldown();
  // 每日上限：按钮静态禁用"明日再试"，不跑秒级倒计时
  const [oldDailyLimit, setOldDailyLimit] = useState(false);

  // Step2 新邮箱 + 新邮箱验证码
  const [newEmail, setNewEmail] = useState("");
  const [newEmailError, setNewEmailError] = useState("");
  const [newSent, setNewSent] = useState(false);
  const [newSending, setNewSending] = useState(false);
  const [newCooldown, setNewCooldown] = useOtpCooldown();
  const [newDailyLimit, setNewDailyLimit] = useState(false);
  const [newOtp, setNewOtp] = useState("");

  const [emailChangeToken, setEmailChangeToken] = useState("");
  const [successEmail, setSuccessEmail] = useState("");
  const closeTimer = useRef<number | null>(null);
  const oldOtpRef = useRef<HTMLInputElement | null>(null);
  const newOtpRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // ── 发送当前邮箱验证码 ──
  async function sendOldOtp() {
    if (oldSending) return;
    setMsg(null);
    setOldSending(true);
    try {
      const res = await fetch("/api/account/email/send-old-otp", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "发送失败" });
        applyOtpRetry(data, setOldDailyLimit, setOldCooldown);
        return;
      }
      applyOtpRetry(data, setOldDailyLimit, setOldCooldown, 60);
      // 游客模式：响应体直接携带验证码，立即显示（事件驱动，无轮询）
      showGuestOtpFromResponse(data);
      oldOtpRef.current?.focus({ preventScroll: true });
    } finally {
      setOldSending(false);
    }
  }

  // ── 输满 6 位自动验证当前邮箱 → 服务器签发 email_change_token ──
  async function verifyOldOtp(otp: string) {
    if (otp.length !== 6 || loading) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/email/verify-old", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOldOtp("");
        setMsg({ ok: false, text: data.error ?? "验证失败" });
        return;
      }
      setEmailChangeToken(data.emailChangeToken);
      setStep("enter-new");
    } finally {
      setLoading(false);
    }
  }

  // ── 发送新邮箱验证码 ──
  async function sendNewOtp() {
    if (newSending) return;
    setMsg(null);
    setNewEmailError("");
    const value = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setNewEmailError("邮箱格式不正确");
      return;
    }
    if (value === currentEmail.toLowerCase()) {
      setNewEmailError("新邮箱不能与当前邮箱相同");
      return;
    }
    setNewSending(true);
    try {
      const res = await fetch("/api/account/email/send-new-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailChangeToken, newEmail: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "发送失败" });
        applyOtpRetry(data, setNewDailyLimit, setNewCooldown);
        return;
      }
      applyOtpRetry(data, setNewDailyLimit, setNewCooldown, 60);
      setNewEmail(value);
      setNewSent(true);
      // 游客模式：响应体直接携带验证码，立即显示（事件驱动，无轮询）
      showGuestOtpFromResponse(data);
      newOtpRef.current?.focus({ preventScroll: true });
    } finally {
      setNewSending(false);
    }
  }

  // ── 输满 6 位自动验证新邮箱并立即完成修改 ──
  async function completeEmailChange(otp: string) {
    if (otp.length !== 6 || loading) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/email/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailChangeToken, newEmail, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNewOtp("");
        setMsg({ ok: false, text: data.error ?? "修改失败" });
        return;
      }
      setSuccessEmail(newEmail);
      setStep("success");
      closeTimer.current = window.setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1600);
    } finally {
      setLoading(false);
    }
  }

  const busy = oldSending || newSending || loading;
  const dirty =
    step !== "success" && (newEmail.trim() !== "" || newSent);

  return (
    <Modal
      open
      onClose={onClose}
      title="修改登录邮箱"
      busy={busy}
      dirty={dirty}
      plainHeader
    >
      {step === "verify-current" && (
        <div key="verify-current" className="animate-step">
          <StepIndicator steps={STEPS} current={0} />

          <p className="text-[16px] font-semibold text-[#1d1d1f]">
            验证当前邮箱
          </p>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#6e6e73]">
            为了保护账号安全，请先验证当前绑定邮箱。
          </p>

          <p className="mt-4 text-[13px] text-[#6e6e73]">当前绑定邮箱</p>
          <div className="info-card mt-1.5">
            <span className="info-card-icon">{ICON_MAIL}</span>
            <span className="break-email min-w-0 text-[15px] font-semibold text-[#1d1d1f]">
              {currentEmail}
            </span>
          </div>

          {/* 单行：验证码输入 + 获取验证码，输满 6 位自动验证 */}
          <div className="mt-4 flex items-center gap-2.5">
            <input
              ref={oldOtpRef}
              value={oldOtp}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOldOtp(v);
                setMsg(null);
                if (v.length === 6) void verifyOldOtp(v);
              }}
              placeholder="输入验证码"
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={loading}
              className="h-[44px] min-w-0 flex-1 rounded-full border border-[rgba(0,0,0,0.12)] bg-white px-4 text-center text-[16px] tracking-[0.25em] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
            />
            <button
              type="button"
              onClick={sendOldOtp}
              disabled={oldSending || oldCooldown > 0 || oldDailyLimit || loading}
              className="btn-primary otp-send"
            >
              {oldSending
                ? "发送中…"
                : oldDailyLimit
                  ? "明日再试"
                  : oldCooldown > 0
                    ? `${oldCooldown}s 后重发`
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

      {step === "enter-new" && (
        <div key="enter-new" className="animate-step">
          <BackLink onClick={() => setStep("verify-current")} />
          <StepIndicator steps={STEPS} current={1} />

          <p className="text-[16px] font-semibold text-[#1d1d1f]">
            设置新的登录邮箱
          </p>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#6e6e73]">
            新的邮箱将用于后续登录、身份验证和接收安全通知。
          </p>

          <label className="mb-2 mt-4 block text-[14px] font-medium text-[#1d1d1f]">
            新邮箱地址
          </label>
          <input
            type="email"
            placeholder="name@example.com"
            value={newEmail}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setNewEmailError("");
              setMsg(null);
            }}
            className={`input ${newEmailError ? "input-error" : ""}`}
          />
          <p className="field-error">{newEmailError}</p>

          {/* 单行：验证码输入 + 获取验证码，输满 6 位自动完成 */}
          <div className="mt-4 flex items-center gap-2.5">
            <input
              ref={newOtpRef}
              value={newOtp}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setNewOtp(v);
                setMsg(null);
                if (v.length === 6) void completeEmailChange(v);
              }}
              placeholder="输入验证码"
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={loading}
              className="h-[44px] min-w-0 flex-1 rounded-full border border-[rgba(0,0,0,0.12)] bg-white px-4 text-center text-[16px] tracking-[0.25em] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
            />
            <button
              type="button"
              onClick={sendNewOtp}
              disabled={newSending || newCooldown > 0 || newDailyLimit || loading}
              className="btn-primary otp-send"
            >
              {newSending
                ? "发送中…"
                : newDailyLimit
                  ? "明日再试"
                  : newCooldown > 0
                    ? `${newCooldown}s 后重发`
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

      {step === "success" && (
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
            邮箱修改成功
          </p>
          <p className="break-email mt-1.5 text-[14px] leading-relaxed text-[#6e6e73]">
            你的登录邮箱已经更新为
            <span className="font-semibold text-[#1d1d1f]">{successEmail}</span>
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
