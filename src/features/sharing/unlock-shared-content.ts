import {
  checkUnlockRate,
  clearUnlockRate,
  recordUnlockFailure,
  verifySharePassword,
} from "./report-share";

export type ShareUnlockAttempt =
  | { kind: "no-password" }
  | { kind: "ok" }
  | { kind: "unlock-rate"; retryAfter: number }
  | { kind: "wrong-passcode" };

/**
 * 分享链接与分享面板共用的提取码校验：
 * 限流预占、scrypt 校验、失败计数、成功后清空按同一规则执行。
 * 实体查找、404 文案与解锁 Cookie 仍由各自的 Route Handler 负责。
 *
 * @param rateKey 分享链接用 token，分享面板用 `board:${token}`
 */
export async function verifyShareUnlockAttempt(input: {
  token: string;
  ip: string;
  password: unknown;
  passwordHash: string | null;
  rateKey: string;
}): Promise<ShareUnlockAttempt> {
  if (!input.passwordHash) return { kind: "no-password" };

  const rate = await checkUnlockRate(input.rateKey, input.ip);
  if (!rate.ok) {
    return { kind: "unlock-rate", retryAfter: rate.retryAfter ?? 60 };
  }

  const password =
    typeof input.password === "string" ? input.password.toUpperCase() : "";
  if (
    !password ||
    password.length !== 4 ||
    !(await verifySharePassword(password, input.passwordHash))
  ) {
    const failure = await recordUnlockFailure(input.rateKey);
    if (!failure.ok) {
      return { kind: "unlock-rate", retryAfter: failure.retryAfter ?? 60 };
    }
    return { kind: "wrong-passcode" };
  }

  await clearUnlockRate(input.rateKey, input.ip);
  return { kind: "ok" };
}
