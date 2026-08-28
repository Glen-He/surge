"use client";

import { useEffect, useState } from "react";

export function useOtpCooldown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

export function applyOtpRetry(
  data: { code?: unknown; retryAfter?: unknown } | null | undefined,
  setDailyLimit: (value: boolean) => void,
  setCooldown: (value: number) => void,
  fallbackSeconds?: number,
): void {
  if (
    data?.code === "OTP_DAILY_LIMIT" ||
    (typeof data?.retryAfter === "number" && data.retryAfter > 600)
  ) {
    setDailyLimit(true);
    return;
  }
  if (typeof data?.retryAfter === "number" && data.retryAfter > 0) {
    setCooldown(data.retryAfter);
  } else if (fallbackSeconds) {
    setCooldown(fallbackSeconds);
  }
}
