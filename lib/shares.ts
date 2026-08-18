import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "./db";
import { ensureOtpMigration } from "./schema";
import { rateLimit } from "./rate-limit";

// ── 分享链接工具 ──
// token 用 22 位 base62（≈131bit 熵），不可枚举；
// 密码 scrypt 存储；解锁凭证为 HMAC(token, 服务端密钥)，客户端不可伪造。

const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateShareToken(len = 22): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += TOKEN_ALPHABET[bytes[i] % 62];
  return out;
}

export function generateShareId(): string {
  return randomBytes(16).toString("hex");
}

export function hashSharePassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifySharePassword(
  password: string,
  stored: string,
): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const calc = scryptSync(password, salt, 32);
  const expect = Buffer.from(hash, "hex");
  return (
    calc.length === expect.length && timingSafeEqual(calc, expect)
  );
}

// 解锁 cookie 值：HMAC(token, SECRET)。SECRET 缺省派生自 DATABASE_URL，
// 生产建议显式配置 SHARE_SECRET。
function shareSecret(): string {
  return process.env.SHARE_SECRET || process.env.DATABASE_URL || "dev-only";
}

export function unlockProof(token: string): string {
  return createHmac("sha256", shareSecret())
    .update(`share-unlock:${token}`)
    .digest("hex");
}

export function unlockCookieName(token: string): string {
  return `share_${token}`;
}

// ── 查询 ──

export interface ShareRow {
  id: string;
  report_id: string;
  token: string;
  password_hash: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  view_count: number;
  created_at: Date;
}

/** 按属主列出某报告的全部分享（含已撤销，管理页需要看到） */
export async function listSharesBySlug(
  userId: string,
  slug: string,
): Promise<ShareRow[]> {
  await ensureOtpMigration();
  const r = await db.query<ShareRow>(
    `SELECT s.* FROM report_shares s
     JOIN reports r ON r.id = s.report_id
     WHERE r.user_id = $1 AND r.slug = $2
     ORDER BY s.created_at DESC`,
    [userId, slug],
  );
  return r.rows;
}

/** 按属主列出其全部报告的全部分享 */
export async function listAllShares(
  userId: string,
): Promise<(ShareRow & { report_title: string; report_slug: string })[]> {
  await ensureOtpMigration();
  const r = await db.query<ShareRow & { report_title: string; report_slug: string }>(
    `SELECT s.*, r.title AS report_title, r.slug AS report_slug
     FROM report_shares s
     JOIN reports r ON r.id = s.report_id
     WHERE r.user_id = $1
     ORDER BY s.created_at DESC`,
    [userId],
  );
  return r.rows;
}

export interface ValidShare {
  share: ShareRow;
  ownerId: string;
  ownerDir: string; // reports/users/<ownerId>/<slug>
  reportTitle: string;
}

/** token → 有效分享（存在 + 未撤销 + 未过期）；无效返回 null */
export async function findValidShare(
  token: string,
): Promise<ValidShare | null> {
  await ensureOtpMigration();
  const r = await db.query<
    ShareRow & { owner_id: string; slug: string; report_title: string }
  >(
    `SELECT s.*, r.user_id AS owner_id, r.slug, r.title AS report_title
     FROM report_shares s
     JOIN reports r ON r.id = s.report_id
     WHERE s.token = $1 LIMIT 1`,
    [token],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
  const { owner_id, slug, report_title, ...share } = row;
  return {
    share,
    ownerId: owner_id,
    ownerDir: `${owner_id}/${slug}`,
    reportTitle: report_title,
  };
}

export async function incrementShareView(token: string) {
  await db.query(
    `UPDATE report_shares SET view_count = view_count + 1 WHERE token = $1`,
    [token],
  );
}

// viewCount 防刷：同一 IP 对同一 token 1 小时内只计 1 次浏览。
// 进程内限流（危害本身有限——最多计数失真，无需持久化）
export function shouldCountView(token: string, ip: string): boolean {
  return rateLimit(`sv:${token}:${ip}`, 1, 60 * 60 * 1000);
}

/** 分享是否仍有效（管理列表用轻量判断） */
export function shareStatus(row: {
  revoked_at: Date | null;
  expires_at: Date | null;
}): "active" | "revoked" | "expired" {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return "expired";
  return "active";
}

// ── 解锁尝试限速（内存实现，单实例部署足够；窗口 10 分钟 10 次） ──

const attempts = new Map<string, { n: number; reset: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function checkUnlockRate(token: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const rec = attempts.get(token);
  if (!rec || rec.reset < now) {
    attempts.set(token, { n: 1, reset: now + WINDOW_MS });
    return { ok: true };
  }
  rec.n++;
  if (rec.n > MAX_ATTEMPTS) {
    return { ok: false, retryAfter: Math.ceil((rec.reset - now) / 1000) };
  }
  return { ok: true };
}

export function clearUnlockRate(token: string): void {
  attempts.delete(token);
}
