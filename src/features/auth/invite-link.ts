/** 构造不会发送给服务器或 Referer 的邀请码 fragment。 */
export function inviteLinkFragment(code: string): string {
  return `invite=${encodeURIComponent(code.trim().toUpperCase())}`;
}

/** 从邀请链接 fragment 中读取规范化的六位邀请码。 */
export function inviteCodeFromFragment(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = (params.get("invite") ?? "").trim().toUpperCase();
  return /^[0-9A-Z]{6}$/.test(code) ? code : null;
}
