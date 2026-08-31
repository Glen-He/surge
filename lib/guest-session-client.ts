export const GUEST_WELCOME_KEY = "surge:guest-login-toast";
export const GUEST_EXPIRY_KEY = "surge:guest-expires-at";
export const GUEST_EXPIRY_EVENT = "surge:guest-expiry-changed";

export function rememberGuestExpiry(expiresAt: string): void {
  try {
    localStorage.setItem(GUEST_EXPIRY_KEY, expiresAt);
    window.dispatchEvent(new Event(GUEST_EXPIRY_EVENT));
  } catch {
    // Private browsing / blocked storage: server-side expiry remains authoritative.
  }
}

export function readGuestExpiry(): string | null {
  try {
    return localStorage.getItem(GUEST_EXPIRY_KEY);
  } catch {
    return null;
  }
}

export function removeGuestExpiry(): void {
  try {
    localStorage.removeItem(GUEST_EXPIRY_KEY);
  } catch {
    // No client state to clear when storage is unavailable.
  }
}

export function clearGuestClientState(): void {
  removeGuestExpiry();
  try {
    sessionStorage.removeItem(GUEST_WELCOME_KEY);
    window.dispatchEvent(new Event(GUEST_EXPIRY_EVENT));
  } catch {
    // The server cookie has already been cleared; local storage is optional UX.
  }
}
