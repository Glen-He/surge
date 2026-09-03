export function shareUrlWithPasscode(url: string, passcode?: string | null): string {
  if (!passcode) return url;
  const parsed = new URL(url);
  parsed.hash = new URLSearchParams({ pwd: passcode }).toString();
  return parsed.toString();
}

export function sharePasscodeFromHash(hash: string): string | null {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const passcode = new URLSearchParams(normalized).get("pwd")?.toUpperCase() ?? "";
  return /^[A-Z0-9]{4}$/.test(passcode) ? passcode : null;
}

export function shareClipboardText(url: string, passcode?: string | null): string {
  const shareUrl = shareUrlWithPasscode(url, passcode);
  return passcode ? `链接：${shareUrl}\n提取码：${passcode}` : shareUrl;
}
