import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { isValidShareToken } from "./report-share";

// 所有公开入口共用 IP 桶，随机切换 token 或入口不能重置预算。
// 只缓存已封禁结果，避免持续攻击反复写库；允许结果始终由数据库裁决。
const blockedUntil = new Map<string, number>();

/** 在查询分享、面板及成员之前消费准入额度。 */
export async function checkShareLookupRate(ip: string, token: string) {
  // 格式错误由调用方的查找函数直接返回无效，不为明显垃圾输入访问数据库。
  if (!isValidShareToken(token)) return { allowed: true, retryAfter: 0 };
  const now = Date.now();
  const until = blockedUntil.get(ip) ?? 0;
  if (until > now) return { allowed: false, retryAfter: Math.ceil((until - now) / 1000) };
  blockedUntil.delete(ip);
  const result = await consumeSharedRateLimit("share-lookup", ip, 60, 60);
  if (!result.allowed) {
    if (blockedUntil.size >= 10_000) {
      for (const [key, expiry] of blockedUntil) if (expiry <= now) blockedUntil.delete(key);
      if (blockedUntil.size >= 10_000) blockedUntil.delete(blockedUntil.keys().next().value!);
    }
    blockedUntil.set(ip, now + result.retryAfter * 1000);
  }
  return result;
}
