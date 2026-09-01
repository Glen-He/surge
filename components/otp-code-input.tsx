"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  type InputHTMLAttributes,
} from "react";
import {
  isOtpCode,
  normalizeOtpCode,
  OTP_CODE_LENGTH,
} from "@/lib/otp-code";

type OtpCodeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | "autoComplete"
  | "inputMode"
  | "maxLength"
  | "onChange"
  | "pattern"
  | "type"
  | "value"
> & {
  value: string;
  onValueChange: (value: string) => void;
  onComplete?: (value: string) => void;
  autoComplete?: "one-time-code" | "off";
};

/**
 * 平台统一验证码输入框。浏览器只面对一个真实 input，既兼容 Apple
 * one-time-code 自动填充，也避免多输入框拆分验证码时产生重复事件。
 */
export const OtpCodeInput = forwardRef<HTMLInputElement, OtpCodeInputProps>(
  function OtpCodeInput(
    {
      value,
      onValueChange,
      onComplete,
      autoComplete = "one-time-code",
      ...props
    },
    ref,
  ) {
    const completedRef = useRef<string | null>(null);

    useEffect(() => {
      if (!isOtpCode(value)) completedRef.current = null;
    }, [value]);

    return (
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={OTP_CODE_LENGTH}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => {
          const next = normalizeOtpCode(event.target.value);
          onValueChange(next);
          if (!isOtpCode(next)) {
            completedRef.current = null;
            return;
          }
          if (completedRef.current === next) return;
          completedRef.current = next;
          onComplete?.(next);
        }}
      />
    );
  },
);
