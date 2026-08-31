"use client";

import { useEffect, useRef } from "react";
import { sharePasscodeFromHash } from "@/lib/share-copy";

/**
 * Reads a passcode from the URL fragment, removes it from browser history, and
 * hands it to the password gate. Fragments never reach proxy/server logs.
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
