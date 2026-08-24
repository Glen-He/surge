"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import { showGuestOtpFromResponse } from "@/lib/guest-otp-store";

// 删除账号确认弹窗：单行 验证码输入 + 获取验证码；邮箱验证 + 15 天冷却期
export function DeleteAccountModal({
  open,
  onClose,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // 每日上限：按钮静态禁用"明日再试"，不跑秒级倒计时
  const [dailyLimit, setDailyLimit] = useState(false);

  // 关闭时重置，避免残留状态
  useEffect(() => {
    if (!open) {
      setLoading(false);
      setError("");
      setOtp("");
      setOtpSending(false);
      setCooldown(0);
      setDailyLimit(false);
    }
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendOtp() {
    if (otpSending || cooldown > 0 || loading) return;
    setOtpSending(true);
    setError("");
    try {
      const res = await fetch("/api/account/deletion/send-otp", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "验证码发送失败，请稍后重试");
        if (
          data?.code === "OTP_DAILY_LIMIT" ||
          (typeof data?.retryAfter === "number" && data.retryAfter > 600)
        ) {
          setDailyLimit(true);
        } else if (typeof data?.retryAfter === "number") {
          setCooldown(data.retryAfter);
        }
        return;
      }
      setCooldown(data?.retryAfter ?? 60);
      // 访客模式：响应体直接携带验证码，立即显示（事件驱动，无轮询）
      showGuestOtpFromResponse(data);
    } finally {
      setOtpSending(false);
    }
  }

  async function confirm() {
    if (loading || otp.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/account/deletion/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otp }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "操作失败，请稍后重试");
        return;
      }
      onScheduled();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="删除账号？" busy={loading} plainHeader>
      <p className="text-[14px] leading-[1.55] text-[#6e6e73]">
        申请后账号进入 15 天冷却期，期间可正常登录并随时取消；冷却期结束后，账号及名下全部报告与数据将被永久删除，无法恢复。请先完成邮箱验证。
      </p>

      {/* 单行：验证码输入（浅 44）+ 获取验证码（深 42，光学小 1px） */}
      <div className="mt-4 flex items-center gap-2.5">
        <input
          value={otp}
          onChange={(e) => {
            setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
            setError("");
          }}
          placeholder="输入验证码"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={loading}
          className="h-[44px] min-w-0 flex-1 rounded-full border border-[rgba(0,0,0,0.12)] bg-white px-4 text-center text-[16px] tracking-[0.25em] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
        />
        <button
          type="button"
          onClick={() => void sendOtp()}
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

      <p className="min-h-[20px] mt-2 text-[13px] leading-[1.4] text-[#e0301e]">
        {error}
      </p>

      <div className="modal-actions">
        <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">
          取消
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={loading || otp.length !== 6}
          className="btn-danger"
        >
          {loading ? "提交中…" : "申请删除"}
        </button>
      </div>
    </Modal>
  );
}
