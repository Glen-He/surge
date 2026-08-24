/**
 * 「认证续跳」标记（纯 sessionStorage 读写，零依赖，client/server 皆可 import）。
 *
 * 生命周期：登录成功 navigateAfterAuth 落标记 → 若跳转被 307 弹回登录页，
 * 登录页 mount 时发现标记 → 轮询会话就绪后自动再跳；/home 成功落地时由
 * <RelaunchClear /> 清掉（见 components/relaunch-clear.tsx）。
 * 标记只在「认证成功 → 首次落地 /home」之间存活，60s 超龄自动失效。
 */

const RELAUNCH_KEY = "surge:auth-relaunch";
const RELAUNCH_MAX_AGE_MS = 60_000;

/** 登录成功、整页跳转前落标记（写入方：lib/auth-flow 的 navigateAfterAuth） */
export function markRelaunchIntent(): void {
  try {
    sessionStorage.setItem(RELAUNCH_KEY, String(Date.now()));
  } catch {
    /* 无痕模式等场景静默忽略 */
  }
}

/** 登录页 mount 时检查是否存在未超龄的续跳标记（超龄的顺手清掉） */
export function hasFreshRelaunchIntent(): boolean {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RELAUNCH_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts) || Date.now() - ts > RELAUNCH_MAX_AGE_MS) {
    clearRelaunchIntent();
    return false;
  }
  return true;
}

export function clearRelaunchIntent(): void {
  try {
    sessionStorage.removeItem(RELAUNCH_KEY);
  } catch {
    /* ignore */
  }
}
