export const GUEST_WELCOME_KEY = "surge:guest-login-toast";
export const GUEST_EXPIRY_KEY = "surge:guest-expires-at";
export const GUEST_EXPIRY_EVENT = "surge:guest-expiry-changed";

export function rememberGuestExpiry(expiresAt: string): void {
  try {
    localStorage.setItem(GUEST_EXPIRY_KEY, expiresAt);
    window.dispatchEvent(new Event(GUEST_EXPIRY_EVENT));
  } catch {
    // 隐私模式 / 存储被禁用：以服务端到期时间为准。
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
    // 存储不可用时没有客户端状态可清理。
  }
}

export function clearGuestClientState(): void {
  removeGuestExpiry();
  try {
    sessionStorage.removeItem(GUEST_WELCOME_KEY);
    window.dispatchEvent(new Event(GUEST_EXPIRY_EVENT));
  } catch {
    // 服务端 cookie 已清除；本地存储只是可选的交互增强。
  }
}
