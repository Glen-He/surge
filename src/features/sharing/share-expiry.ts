/**
 * 分享有效期档位单一来源：分享链接与分享面板共用同一组预设、同一套校验与换算。
 * 天数 0 表示永久有效；UI 下拉选项、服务端校验与到期时刻换算都从这里取，
 * 避免两处各自维护一份档位表而漂移。
 */

/** 允许的档位（天）：永久 / 1 / 7 / 30 / 90。 */
export const SHARE_EXPIRY_DAYS = [0, 1, 7, 30, 90] as const;

export type ShareExpiryDays = (typeof SHARE_EXPIRY_DAYS)[number];

export type ShareExpiryOption = { value: ShareExpiryDays; label: string };

/** 下拉选项：与 SelectMenu 的选项结构一致，两个弹窗直接复用。 */
export const SHARE_EXPIRY_OPTIONS: ShareExpiryOption[] = SHARE_EXPIRY_DAYS.map(
  (days) => ({ value: days, label: days === 0 ? "永久有效" : `${days} 天` }),
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** 校验档位；不是预设值（含缺失、非整数）返回 null。 */
export function parseShareExpiryDays(value: unknown): ShareExpiryDays | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return (SHARE_EXPIRY_DAYS as readonly number[]).includes(value)
    ? (value as ShareExpiryDays)
    : null;
}

/** 档位换算为到期时刻；永久（0）返回 null。 */
export function shareExpiryDate(
  days: ShareExpiryDays,
  now = Date.now(),
): Date | null {
  return days > 0 ? new Date(now + days * DAY_MS) : null;
}

/**
 * 由已有到期时刻反推最接近的档位，用于编辑弹窗回显：
 * 未设置（永久）返回 0；已过期按 0 处理；其余取剩余天数最接近的档位，等距时取较大档。
 */
export function nearestShareExpiryDays(
  expiresAt: Date | null,
  now = Date.now(),
): ShareExpiryDays {
  if (!expiresAt) return 0;
  const remainingDays = (expiresAt.getTime() - now) / DAY_MS;
  if (remainingDays <= 0) return 0;
  let best: ShareExpiryDays = SHARE_EXPIRY_DAYS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const days of SHARE_EXPIRY_DAYS) {
    const distance = Math.abs(remainingDays - days);
    if (distance < bestDistance || (distance === bestDistance && days > best)) {
      best = days;
      bestDistance = distance;
    }
  }
  return best;
}
