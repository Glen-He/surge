import {
  clearSecurityFailures,
  isSecurityRateLimited,
  recordSecurityFailure,
} from "@/infrastructure/database/rate-limit";
import { internalAuthProof, verifyInternalAuthProof } from "@/infrastructure/security/internal-auth-proof";

const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_ACCOUNT_MAX = 10;
const LOGIN_IP_MAX = 30;
const REAUTH_WINDOW_SECONDS = 15 * 60;
const REAUTH_MAX = 5;

/** 把原生凭据登录限制在带频控的 Server Action 内使用 */
export function passwordLoginInternalProof(email: string): string {
  return internalAuthProof("password-login", email.trim().toLowerCase());
}

export function verifyPasswordLoginInternalProof(
  email: string,
  proof: string | null | undefined,
): boolean {
  return verifyInternalAuthProof(
    "password-login",
    email.trim().toLowerCase(),
    proof,
  );
}

function loginSubjects(email: string, ip: string) {
  return [
    ["password-login-account", email.trim().toLowerCase(), LOGIN_ACCOUNT_MAX] as const,
    ["password-login-ip", ip, LOGIN_IP_MAX] as const,
  ];
}

export async function checkPasswordLoginAllowed(
  email: string,
  ip: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const checks = await Promise.all(
    loginSubjects(email, ip).map(([namespace, subject, max]) =>
      isSecurityRateLimited(namespace, subject, max),
    ),
  );
  return {
    allowed: checks.every((check) => !check.limited),
    retryAfter: Math.max(0, ...checks.map((check) => check.retryAfter)),
  };
}

export async function recordPasswordLoginFailure(
  email: string,
  ip: string,
): Promise<void> {
  await Promise.all(
    loginSubjects(email, ip).map(([namespace, subject, max]) =>
      recordSecurityFailure(namespace, subject, max, LOGIN_WINDOW_SECONDS),
    ),
  );
}

export async function clearPasswordLoginFailures(
  email: string,
): Promise<void> {
  // 登录成功即证明掌控该账号，可释放账号级锁定；
  // 源 IP 桶保留到自然过期，否则攻击者可反复登录自己控制的账号
  // 来抹掉分布式累计的失败记录。
  await clearSecurityFailures(
    "password-login-account",
    email.trim().toLowerCase(),
  );
}

export async function checkReauthenticationAllowed(
  userId: string,
  ip: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const [user, address] = await Promise.all([
    isSecurityRateLimited("password-reauth-user", userId, REAUTH_MAX),
    isSecurityRateLimited("password-reauth-ip", ip, REAUTH_MAX * 4),
  ]);
  return {
    allowed: !user.limited && !address.limited,
    retryAfter: Math.max(user.retryAfter, address.retryAfter),
  };
}

export async function recordReauthenticationFailure(
  userId: string,
  ip: string,
): Promise<void> {
  await Promise.all([
    recordSecurityFailure(
      "password-reauth-user",
      userId,
      REAUTH_MAX,
      REAUTH_WINDOW_SECONDS,
    ),
    recordSecurityFailure(
      "password-reauth-ip",
      ip,
      REAUTH_MAX * 4,
      REAUTH_WINDOW_SECONDS,
    ),
  ]);
}

export async function clearReauthenticationFailures(
  userId: string,
): Promise<void> {
  await clearSecurityFailures("password-reauth-user", userId);
}
