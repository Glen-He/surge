import { createHmac, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "node:util";
import { db } from "./db";
import { ensureOtpMigration } from "./schema";
import { consumeSharedRateLimit } from "./db-rate-limit";
import {
  clearSecurityFailures,
  isSecurityRateLimited,
  recordSecurityFailure,
} from "./db-rate-limit";
import {
  decryptSharePasscode,
  decryptShareToken,
  ensureShareTokensProtected,
  shareTokenHash,
} from "./share-token-store";

// ── 分享链接工具 ──
// token 用 22 位 base62（≈131bit 熵），不可枚举；
// 密码 scrypt 存储；解锁凭证为 HMAC(token, 服务端密钥)，客户端不可伪造。

const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateShareToken(len = 22): string {
  // rejection sampling 消除模偏差：256 % 62 = 8，直接取模会让前 8 个
  // 字符（A-H）的概率略高；丢弃 >= 248 的字节后每个字符严格等概率
  const LIMIT = 256 - (256 % 62);
  let out = "";
  while (out.length < len) {
    const bytes = randomBytes(len);
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      if (bytes[i] < LIMIT) out += TOKEN_ALPHABET[bytes[i] % 62];
    }
  }
  return out;
}

export function generateShareId(): string {
  return randomBytes(16).toString("hex");
}

export const SHARE_PASSCODE_LENGTH = 4;
const SHARE_PASSCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Four-character, cryptographically random extraction code. */
export function generateSharePasscode(): string {
  const limit = 256 - (256 % SHARE_PASSCODE_ALPHABET.length);
  let result = "";
  while (result.length < SHARE_PASSCODE_LENGTH) {
    for (const byte of randomBytes(SHARE_PASSCODE_LENGTH)) {
      if (byte < limit) result += SHARE_PASSCODE_ALPHABET[byte % SHARE_PASSCODE_ALPHABET.length];
      if (result.length === SHARE_PASSCODE_LENGTH) break;
    }
  }
  return result;
}

export function isValidSharePasscode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{4}$/.test(value);
}

const scryptAsync = promisify(scrypt);

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 32) as Buffer).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export async function verifySharePassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const calc = await scryptAsync(password, salt, 32) as Buffer;
  const expect = Buffer.from(hash, "hex");
  return (
    calc.length === expect.length && timingSafeEqual(calc, expect)
  );
}

// 解锁 cookie 值：HMAC(token, SECRET)。
// 生产必须使用独立 SHARE_SECRET，避免轮换数据库口令时意外轮换
// 分享凭证密钥。开发环境仅保留一个本地回退值。
// HMAC 伪造解锁凭证，绕过所有受密码保护的分享。
function shareSecret(): string {
  if (process.env.SHARE_SECRET) return process.env.SHARE_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少 SHARE_SECRET：分享解锁凭证无独立签名密钥");
  }
  return "dev-only";
}

export function unlockProof(token: string): string {
  return createHmac("sha256", shareSecret())
    .update(`share-unlock:${token}`)
    .digest("hex");
}

// 恒时校验解锁 cookie：HMAC 是确定性值，普通 !== 在理论上可被
// 计时逐字节恢复（与资产签名校验同一套 timingSafeEqual 防护）
export function verifyUnlockProof(
  token: string,
  proof: string | undefined,
): boolean {
  if (!proof) return false;
  const expect = Buffer.from(unlockProof(token), "hex");
  const got = Buffer.from(proof, "hex");
  return got.length === expect.length && timingSafeEqual(got, expect);
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
  passcode: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  view_count: number;
  created_at: Date;
}

type StoredShareRow = Omit<ShareRow, "token" | "passcode"> & {
  token: string | null;
  token_enc: string | null;
  password_enc: string | null;
};

function revealShare(row: StoredShareRow): ShareRow {
  const token = row.token ?? (row.token_enc ? decryptShareToken(row.token_enc) : "");
  if (!token) throw new Error("share token is unavailable");
  return {
    id: row.id,
    report_id: row.report_id,
    token,
    password_hash: row.password_hash,
    passcode: row.password_enc ? decryptSharePasscode(row.password_enc) : null,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    view_count: row.view_count,
    created_at: row.created_at,
  };
}

/** 按属主列出某报告的全部分享（含已撤销，管理页需要看到） */
export async function listSharesBySlug(
  userId: string,
  slug: string,
): Promise<ShareRow[]> {
  await ensureOtpMigration();
  await ensureShareTokensProtected();
  const r = await db.query<StoredShareRow>(
    `SELECT s.* FROM report_shares s
     JOIN reports r ON r.id = s.report_id
     WHERE r.user_id = $1 AND r.slug = $2
     ORDER BY s.created_at DESC`,
    [userId, slug],
  );
  return r.rows.map(revealShare);
}

/** 按属主列出其全部报告的全部分享 */
export async function listAllShares(
  userId: string,
): Promise<(ShareRow & { report_title: string; report_slug: string })[]> {
  await ensureOtpMigration();
  await ensureShareTokensProtected();
  const r = await db.query<StoredShareRow & { report_title: string; report_slug: string }>(
    `SELECT s.*, r.title AS report_title, r.slug AS report_slug
     FROM report_shares s
     JOIN reports r ON r.id = s.report_id
     WHERE r.user_id = $1
     ORDER BY s.created_at DESC`,
    [userId],
  );
  return r.rows.map((row) => ({
    ...revealShare(row),
    report_title: row.report_title,
    report_slug: row.report_slug,
  }));
}

export interface ValidShare {
  share: ShareRow;
  ownerId: string;
  ownerDir: string; // reports/users/<ownerId>/<slug>
  reportTitle: string;
  reportId: string;
  revisionId: string; // 报告内容世代（签发 capability 用）
  capabilityEpoch: number; // capability 纪元（签发 capability 用）
}

/** token → 有效分享（存在 + 未撤销 + 未过期）；无效返回 null */
export async function findValidShare(
  token: string,
): Promise<ValidShare | null> {
  await ensureOtpMigration();
  await ensureShareTokensProtected();
  const r = await db.query<
    StoredShareRow & {
      owner_id: string;
      slug: string;
      report_title: string;
      revision_id: string;
      capability_epoch: number;
    }
  >(
    `SELECT s.*, r.user_id AS owner_id, r.slug, r.title AS report_title,
            r.revision_id, r.capability_epoch
     FROM report_shares s
     JOIN reports r ON r.id = s.report_id
     WHERE s.token_hash = $1 LIMIT 1`,
    [shareTokenHash(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
  const {
    owner_id,
    slug,
    report_title,
    revision_id,
    capability_epoch,
    ...storedShare
  } = row;
  const share = revealShare(storedShare);
  return {
    share,
    ownerId: owner_id,
    ownerDir: `${owner_id}/${slug}`,
    reportTitle: report_title,
    reportId: share.report_id,
    revisionId: revision_id,
    capabilityEpoch: capability_epoch,
  };
}

export async function incrementShareView(token: string) {
  await ensureShareTokensProtected();
  await db.query(
    `UPDATE report_shares SET view_count = view_count + 1 WHERE token_hash = $1`,
    [shareTokenHash(token)],
  );
}

// viewCount 防刷：同一 IP 对同一 token 1 小时内只计 1 次浏览，
// 使用数据库固定窗口保证多实例口径一致。
export async function shouldCountView(token: string, ip: string): Promise<boolean> {
  return (
    await consumeSharedRateLimit("share-view", `${token}:${ip}`, 1, 60 * 60)
  ).allowed;
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

// ── 解锁尝试限速（DB 共享，token + IP 分桶）──

const WINDOW_SEC = 10 * 60;
const MAX_ATTEMPTS = 10;

export async function checkUnlockRate(
  token: string,
  ip: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const subject = `${token}:${ip}`;
  const [current, global] = await Promise.all([
    isSecurityRateLimited("share-unlock", subject, MAX_ATTEMPTS),
    isSecurityRateLimited("share-unlock-token", token, MAX_ATTEMPTS * 5),
  ]);
  if (current.limited || global.limited) {
    return { ok: false, retryAfter: Math.max(current.retryAfter, global.retryAfter) };
  }
  const [recorded, globallyRecorded] = await Promise.all([
    recordSecurityFailure("share-unlock", subject, MAX_ATTEMPTS, WINDOW_SEC),
    recordSecurityFailure("share-unlock-token", token, MAX_ATTEMPTS * 5, WINDOW_SEC),
  ]);
  return recorded.limited || globallyRecorded.limited
    ? { ok: false, retryAfter: Math.max(recorded.retryAfter, globallyRecorded.retryAfter) }
    : { ok: true };
}

export async function clearUnlockRate(token: string, ip: string): Promise<void> {
  // Preserve the token-wide bucket so success from one source cannot erase
  // failures accumulated by other addresses.
  await clearSecurityFailures("share-unlock", `${token}:${ip}`);
}
