"use client";

import { useEffect, useRef } from "react";
import { sharePasscodeFromHash } from "@/lib/share-copy";

/**
 * 从 URL fragment 读取提取码、将其从浏览器历史中移除，
 * 并交给密码门组件。fragment 不会进入代理/服务端日志。
 */
export function useAutoSharePasscode(
  enabled: boolean,
  onPasscode: (passcode: string) => void,
) {
  const handled = useRef(false);

  useEffect(() => {
    if (!enabled || handled.current) return;
    const passcode = sharePasscodeFromHash(window.location.hash);
    if (!passcode) return;
    handled.current = true;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    onPasscode(passcode);
  }, [enabled, onPasscode]);
}
