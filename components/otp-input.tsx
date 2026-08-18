"use client";

import { useEffect, useRef, useState } from "react";

const OTP_LENGTH = 6;

// 6 格验证码输入（自动跳格/退格/粘贴/自动填充）
// 桌面 52px 高；错误时红色边框 + 轻微 shake 一次
export function OTPInput({
  value,
  onChange,
  disabled,
  autoFocus,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [shaking, setShaking] = useState(false);

  const digits = value
    .split("")
    .concat(Array(OTP_LENGTH - value.length).fill(""))
    .slice(0, OTP_LENGTH);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // error 变为 true 时触发一次 shake
  useEffect(() => {
    if (!error) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 320);
    return () => clearTimeout(t);
  }, [error]);

  function handleChange(i: number, raw: string) {
    const d = raw.replace(/\D/g, "").slice(-1);
    const next = value.split("");
    next[i] = d;
    const filled = next.join("");
    onChange(filled.slice(0, OTP_LENGTH));
    if (d && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, OTP_LENGTH);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    refs.current[Math.min(text.length, OTP_LENGTH - 1)]?.focus();
  }

  return (
    <div className={`otp-shell ${shaking ? "animate-shake" : ""}`}>
      {Array.from({ length: OTP_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digits[i]}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          aria-label={`验证码第 ${i + 1} 位`}
          className={`h-[48px] w-full rounded-[12px] border bg-white text-center text-lg font-semibold text-[#1d1d1f] outline-none transition-colors ${
            error
              ? "border-[#ff3b30] focus:border-[#ff3b30]"
              : "border-[rgba(0,0,0,0.12)] focus:border-[#007aff]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        />
      ))}
    </div>
  );
}
