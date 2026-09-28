import { isGuestEmail } from "@/features/auth/guest/guest-identity";
import { withShareTokenRetry } from "./share-token-retry";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "node:util";
import { serverEnv } from "@/infrastructure/environment/server";
import { db } from "@/infrastructure/database/client";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import {
  clearSecurityFailures,
  isSecurityRateLimited,
  recordSecurityFailure,
} from "@/infrastructure/database/rate-limit";
import {
  decryptSharePasscode,
  decryptShareToken,
  encryptSharePasscode,
  encryptShareToken,
  shareTokenHash,
} from "@/features/sharing/share-credentials";
import type { DisplayMode } from "@/features/reports/display-mode";
import { ReportShareError } from "@/features/sharing/report-share-errors";
import { parseShareExpiryDays, shareExpiryDate } from "@/features/sharing/share-expiry";

// ── 分享链接工具 ──
// token 用 8 位小写字母和数字；
// 密码 scrypt 存储；解锁凭证为 HMAC(token, 服务端密钥)，客户端不可伪造。

const TOKEN_ALPHABET =
  "abcdefghijklmnopqrstuvwxyz0123456789";
const SHARE_TOKEN_RE = /^[a-z0-9]{8}$/;

/** 使用密码学随机源与拒绝采样生成分享 token，默认八位。 */
export function generateShareToken(len = 8): string {
  // 拒绝采样：丢弃 >= 252 的字节，保证 36 个字符等概率。
  const LIMIT = 256 - (256 % TOKEN_ALPHABET.length);
  let out = "";
  while (out.length < len) {
    const bytes = randomBytes(len);
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      if (bytes[i] < LIMIT) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
    }
  }
  return out;
}

/** 校验外部传入的当前版本分享 token，避免对异常长度输入做哈希或数据库查询。 */
export function isValidShareToken(token: string): boolean {
  return SHARE_TOKEN_RE.test(token);
}

export function generateShareId(): string {
  return randomBytes(16).toString("hex");
}

const SHARE_PASSCODE_LENGTH = 4;
const SHARE_PASSCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 生成四位密码学安全的随机提取码。 */
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

// 自定义提取码接受完整字母数字；自动生成排除易混字符只为便于人工辨认。
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
// 必须使用独立 SHARE_SECRET，避免轮换数据库口令时意外轮换
// 分享凭证密钥；密钥泄漏会允许攻击者伪造解锁凭证，绕过密码保护。
function shareSecret(): string {
  // 该配置始终必需：缺失或过短由 serverEnv 校验抛错。
  return serverEnv.SHARE_SECRET;
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

const MAX_SHARES_PER_REPORT = 5;

export type ManagedShare = {
  id: string;
  token: string;
  hasPassword: boolean;
  passcode: string | null;
  expiresAt: Date | null;
  disabled: boolean;
  viewCount: number;
  createdAt: Date;
};

/** 原子创建属主侧分享链接，并在同一事务内执行归属和数量上限检查。 */
export async function createReportShare(input: {
  userId: string;
  userEmail: string;
  slug: string;
  requestedPasscode?: unknown;
  passwordProtected: boolean;
  expiresInDays?: unknown;
}): Promise<ManagedShare> {
  if (isGuestEmail(input.userEmail)) throw new ReportShareError("SHARE_GUEST_FORBIDDEN");
  const requestedPasscode =
    typeof input.requestedPasscode === "string" && input.requestedPasscode.trim()
      ? input.requestedPasscode.trim().toUpperCase()
      : null;
  if (requestedPasscode && !isValidSharePasscode(requestedPasscode)) {
    throw new ReportShareError("SHARE_PASSCODE_INVALID");
  }
  const expiresInDays = parseShareExpiryDays(input.expiresInDays ?? 0);
  if (expiresInDays === null) {
    throw new ReportShareError("SHARE_EXPIRY_INVALID");
  }
  const passcode =
    requestedPasscode ?? (input.passwordProtected ? generateSharePasscode() : null);
  const expiresAt = shareExpiryDate(expiresInDays);

  // scrypt 在事务外完成，避免昂贵计算长期占用连接或报告行锁。
  const passwordHash = passcode ? await hashSharePassword(passcode) : null;
  const passwordEnc = passcode ? encryptSharePasscode(passcode) : null;
  const id = generateShareId();
  let token = "";
  const createdAt = new Date();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const report = await client.query<{ id: string }>(
      `SELECT id FROM reports
       WHERE user_id = $1 AND slug = $2
       LIMIT 1 FOR UPDATE`,
      [input.userId, input.slug],
    );
    const reportId = report.rows[0]?.id;
    if (!reportId) throw new ReportShareError("SHARE_REPORT_NOT_FOUND");

    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM report_shares WHERE report_id = $1`,
      [reportId],
    );
    if (Number(count.rows[0]?.count ?? 0) >= MAX_SHARES_PER_REPORT) {
      throw new ReportShareError("SHARE_LIMIT_REACHED", {
        max: MAX_SHARES_PER_REPORT,
      });
    }

    await withShareTokenRetry(client, "report_shares_token_hash_unique", async () => {
      token = generateShareToken();
      await client.query(
        `INSERT INTO report_shares
           (id, report_id, token_hash, token_enc, password_hash, password_enc, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          reportId,
          shareTokenHash(token),
          encryptShareToken(token),
          passwordHash,
          passwordEnc,
          expiresAt,
          createdAt,
        ],
      );
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    id,
    token,
    hasPassword: passcode !== null,
    passcode,
    expiresAt,
    disabled: false,
    viewCount: 0,
    createdAt,
  };
}

/** 删除分享授权来源，仅使这个分享签发的访问能力立即失效。 */
export async function revokeReportShare(userId: string, shareId: string): Promise<void> {
  const deleted = await db.query(
    `DELETE FROM report_shares s USING reports r
      WHERE r.id = s.report_id AND r.user_id = $1 AND s.id = $2`,
    [userId, shareId],
  );
  if (!deleted.rowCount) throw new ReportShareError("SHARE_NOT_FOUND");
}

/**
 * 更新属主侧分享设置（有效期 / 提取码 / 暂停分享）。
 *
 * 与面板设置对齐：只有显式传入的字段才会被改写；任何影响访问权限的改动
 * （暂停态、提取码、有效期）都会让 access_epoch + 1，从而立即作废此前签发的
 * 解锁 Cookie（绑定 epoch）与 capability（资源路由按 epoch 校验）。
 * 返回本次生成或清除的提取码，供 UI 回显。
 */
export async function updateReportShareSettings(input: {
  userId: string;
  shareId: string;
  expiresInDays?: unknown;
  password?: unknown;
  regeneratePassword?: unknown;
  disabled?: unknown;
}): Promise<{ passcode: string | null | undefined }> {
  let expiresAt: Date | null | undefined;
  if (input.expiresInDays !== undefined) {
    const days = parseShareExpiryDays(input.expiresInDays);
    if (days === null) throw new ReportShareError("SHARE_EXPIRY_INVALID");
    expiresAt = shareExpiryDate(days);
  }

  let passcode: string | null | undefined;
  let passwordHash: string | null | undefined;
  let passwordEnc: string | null | undefined;
  if (input.regeneratePassword === true) {
    passcode = generateSharePasscode();
    passwordHash = await hashSharePassword(passcode);
    passwordEnc = encryptSharePasscode(passcode);
  } else if (input.password !== undefined) {
    if (input.password === null || input.password === "") {
      passcode = null;
      passwordHash = null;
      passwordEnc = null;
    } else if (typeof input.password === "string") {
      const next = input.password.trim().toUpperCase();
      if (!isValidSharePasscode(next)) {
        throw new ReportShareError("SHARE_PASSCODE_INVALID");
      }
      passcode = next;
      passwordHash = await hashSharePassword(next);
      passwordEnc = encryptSharePasscode(next);
    } else {
      throw new ReportShareError("SHARE_PASSWORD_SETTING_INVALID");
    }
  }

  if (input.disabled !== undefined && typeof input.disabled !== "boolean") {
    throw new ReportShareError("SHARE_DISABLED_INVALID");
  }

  if (
    expiresAt === undefined &&
    passwordHash === undefined &&
    input.disabled === undefined
  ) {
    throw new ReportShareError("SHARE_NO_CHANGES");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      id: string;
      disabled_at: Date | null;
    }>(
      `SELECT s.id, s.disabled_at FROM report_shares s
       JOIN reports r ON r.id = s.report_id
       WHERE s.id = $1 AND r.user_id = $2
       LIMIT 1 FOR UPDATE OF s`,
      [input.shareId, input.userId],
    );
    const row = current.rows[0];
    if (!row) throw new ReportShareError("SHARE_NOT_FOUND");

    const nextDisabled =
      typeof input.disabled === "boolean" ? input.disabled : !!row.disabled_at;
    const accessChanged =
      nextDisabled !== !!row.disabled_at ||
      passwordHash !== undefined ||
      expiresAt !== undefined;

    await client.query(
      `UPDATE report_shares
          SET password_hash = CASE WHEN $2::boolean THEN $3 ELSE password_hash END,
              password_enc = CASE WHEN $2::boolean THEN $4 ELSE password_enc END,
              disabled_at = CASE WHEN $5::boolean THEN NOW() ELSE NULL END,
              expires_at = CASE WHEN $6::boolean THEN $7 ELSE expires_at END,
              access_epoch = access_epoch + CASE WHEN $8::boolean THEN 1 ELSE 0 END
        WHERE id = $1`,
      [
        input.shareId,
        passwordHash !== undefined,
        passwordHash ?? null,
        passwordEnc ?? null,
        nextDisabled,
        expiresAt !== undefined,
        expiresAt ?? null,
        accessChanged,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return { passcode };
}

// ── 查询 ──

export interface ShareRow {
  access_epoch: number;
  id: string;
  report_id: string;
  token: string;
  password_hash: string | null;
  passcode: string | null;
  expires_at: Date | null;
  disabled_at: Date | null;
  view_count: number;
  created_at: Date;
}

type StoredShareRow = Omit<ShareRow, "token" | "passcode"> & {
  token_enc: string;
  password_enc: string | null;
};

function revealShare(row: StoredShareRow): ShareRow {
  return {
    access_epoch: row.access_epoch,
    id: row.id,
    report_id: row.report_id,
    token: decryptShareToken(row.token_enc),
    password_hash: row.password_hash,
    passcode: row.password_enc ? decryptSharePasscode(row.password_enc) : null,
    expires_at: row.expires_at,
    disabled_at: row.disabled_at,
    view_count: row.view_count,
    created_at: row.created_at,
  };
}

/** 按属主列出某报告的全部现存分享。 */
export async function listSharesBySlug(
  userId: string,
  slug: string,
): Promise<ShareRow[]> {
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
): Promise<(ShareRow & { report_title: string; report_slug: string; display_mode: DisplayMode })[]> {
  const r = await db.query<StoredShareRow & { report_title: string; report_slug: string; display_mode: DisplayMode }>(
    `SELECT s.*, r.title AS report_title, r.slug AS report_slug, r.display_mode
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
    display_mode: row.display_mode,
  }));
}

export interface ValidShare {
  displayMode: DisplayMode;
  share: ShareRow;
  ownerId: string;
  reportTitle: string;
  reportId: string;
  revisionId: string; // 报告内容世代（签发 capability 用）
  capabilityEpoch: number; // capability 纪元（签发 capability 用）
}

/** token → 有效分享（存在 + 未暂停 + 未过期）；无效返回 null */
export async function findValidShare(
  token: string,
): Promise<ValidShare | null> {
  if (!isValidShareToken(token)) return null;
  const r = await db.query<
    StoredShareRow & {
      display_mode: DisplayMode;
      owner_id: string;
      report_title: string;
      revision_id: string;
      capability_epoch: number;
    }
  >(
    `SELECT s.*, r.user_id AS owner_id, r.title AS report_title,
            r.revision_id, r.capability_epoch, r.display_mode
     FROM report_shares s
     JOIN reports r ON r.id = s.report_id
     WHERE s.token_hash = $1 LIMIT 1`,
    [shareTokenHash(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  // 暂停分享（disabled_at）与过期都按"无效"处理，公开路径 fail closed
  if (row.disabled_at) return null;
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return null;
  const {
    display_mode,
    owner_id,
    report_title,
    revision_id,
    capability_epoch,
    ...storedShare
  } = row;
  const share = revealShare(storedShare);
  return {
    share,
    ownerId: owner_id,
    displayMode: display_mode,
    reportTitle: report_title,
    reportId: share.report_id,
    revisionId: revision_id,
    capabilityEpoch: capability_epoch,
  };
}

export async function incrementShareView(token: string) {
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

/** 分享状态（管理列表用轻量判断）：暂停优先于过期展示，属主需要看到自己的暂停动作 */
export function shareStatus(row: {
  expires_at: Date | null;
  disabled_at?: Date | null;
}): "active" | "expired" | "paused" {
  if (row.disabled_at) return "paused";
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return "expired";
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
  const global = await isSecurityRateLimited(
    "share-unlock-token-failures",
    token,
    MAX_ATTEMPTS * 5,
  );
  if (global.limited) {
    return { ok: false, retryAfter: global.retryAfter };
  }
  // 每 IP 的准入桶在 scrypt 前预占，限制并发昂贵计算；成功后会清除。
  // token 全局桶只记录实际错误密码，正常访问不会把分享链接锁死。
  const recorded = await recordSecurityFailure(
    "share-unlock-attempt",
    subject,
    MAX_ATTEMPTS,
    WINDOW_SEC,
  );
  return recorded.limited
    ? { ok: false, retryAfter: recorded.retryAfter }
    : { ok: true };
}

export async function recordUnlockFailure(
  token: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const recorded = await recordSecurityFailure(
    "share-unlock-token-failures",
    token,
    MAX_ATTEMPTS * 5,
    WINDOW_SEC,
  );
  return recorded.limited
    ? { ok: false, retryAfter: recorded.retryAfter }
    : { ok: true };
}

export async function clearUnlockRate(token: string, ip: string): Promise<void> {
  // 只清 token+IP 粒度的准入桶；其他地址的真实失败记录继续保留。
  await clearSecurityFailures("share-unlock-attempt", `${token}:${ip}`);
}
