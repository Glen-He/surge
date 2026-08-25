// 进程内固定窗口限流器（单实例部署足够；多实例需换 Redis 等共享存储）。
// 用于低风险防滥用场景：浏览计数防刷、账号级 API 吞吐保护等。
// 计数存于内存：服务重启/开发模式模块重载即清零，无需手动清理。
const buckets = new Map<string, { n: number; reset: number }>();

const MAX_BUCKETS = 10_000;

/**
 * 命中则消耗一个名额并返回 true；超限返回 false（不消耗）。
 * @param key     限流维度键（如 `guest:1.2.3.4`）
 * @param max     窗口内最大次数
 * @param windowMs 窗口时长（毫秒）
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  // 桶数超限时惰性清理过期项，防内存无限增长
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (v.reset < now) buckets.delete(k);
    }
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (b.n >= max) return false;
  b.n++;
  return true;
}
