import { randomInt, randomUUID } from "crypto";
import { db } from "./db";
import nodemailer from "nodemailer";
import { ensureOtpMigration } from "./schema";
import { logger } from "./logger";
import { isGuestEmail } from "./guest-sandbox";

// 邮件发送器（与 auth.ts 同一套 SMTP 配置）
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 通用：记录安全日志（OTP 频控 / 变更凭证 / 审计）
export async function logSecurity(opts: {
  userId?: string | null;
  action: string;
  email?: string | null;
  ip?: string;
  userAgent?: string;
}) {
  try {
    await db.query(
      `INSERT INTO security_logs (user_id, action, email, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [
        opts.userId ?? null,
        opts.action,
        opts.email ?? null,
        opts.ip ?? null,
        opts.userAgent ?? null,
      ],
    );
  } catch (err) {
    logger.error("security-log", "写入安全日志失败", err as Error);
  }
}

/* ================================================================
 * 统一验证码频控（覆盖注册 / 登录 / 修改邮箱 / 修改密码 / 找回密码等）
 * 规则：
 *   - 同一邮箱 60 秒内最多发送 1 次（跨设备，存数据库）
 *   - 同一邮箱自然日最多 10 次（跨设备，按本地自然日）
 * 全部由服务器决定，前端只展示结果。
 * ================================================================ */

export type OtpRateLimit =
  | { ok: true; retryAfter: number; remainingToday: number }
  | { ok: false; reason: "cooldown" | "daily_limit"; retryAfter: number };

export async function checkOtpRateLimit(opts: {
  email: string;
}): Promise<OtpRateLimit> {
  const email = opts.email.toLowerCase().trim();

  // 访客与真实邮箱统一频控（60s 冷却 + 自然日 10 次）：
  // 访客虽不消耗 SMTP 配额，但接口层同样不能只靠前端按钮挡连点；
  // 每个访客 email 唯一，频控互不影响。
  await ensureOtpMigration();

  // 60 秒冷却（同一邮箱）
  const last = await db.query<{ created_at: Date }>(
    `SELECT created_at FROM security_logs
     WHERE email = $1 AND action LIKE 'OTP_%'
       AND created_at > NOW() - INTERVAL '60 seconds'
     ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  if (last.rows[0]) {
    const wait = Math.ceil(
      (last.rows[0].created_at.getTime() + 60_000 - Date.now()) / 1000,
    );
    return { ok: false, reason: "cooldown", retryAfter: Math.max(wait, 1) };
  }

  // 自然日 10 次（同一邮箱）
  const r = await db.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM security_logs
     WHERE email = $1 AND action LIKE 'OTP_%'
       AND created_at >= date_trunc('day', NOW())`,
    [email],
  );
  const todayCount = parseInt(r.rows[0]?.count ?? "0", 10);
  if (todayCount >= 10) {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    return {
      ok: false,
      reason: "daily_limit",
      retryAfter: Math.ceil((tomorrow.getTime() - Date.now()) / 1000),
    };
  }

  return { ok: true, retryAfter: 60, remainingToday: 10 - todayCount };
}

export async function recordOtpSent(email: string, action: string) {
  await logSecurity({ action, email });
}

/* ================================================================
 * 自管 OTP（修改邮箱 / 修改密码使用）
 * 规则：6 位数字 / 5 分钟有效 / 最多错 3 次 / 一次性
 * ================================================================ */

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;

export async function generateAndStoreOtp(opts: {
  email: string;
  purpose: string;
}): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  // 同一邮箱同一用途只保留最新一个验证码
  await db.query(
    `DELETE FROM otp_codes WHERE email = $1 AND purpose = $2`,
    [opts.email.toLowerCase().trim(), opts.purpose],
  );
  await db.query(
    `INSERT INTO otp_codes (id, email, purpose, code, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), opts.email.toLowerCase().trim(), opts.purpose, code, expiresAt],
  );
  return code;
}

export type OtpVerifyResult =
  | { ok: true; remaining: 3 }
  | { ok: false; error: string; remaining: number };

export async function verifyStoredOtp(opts: {
  email: string;
  purpose: string;
  code: string;
}): Promise<OtpVerifyResult> {
  const email = opts.email.toLowerCase().trim();
  const r = await db.query<{
    id: string;
    code: string;
    attempts: number;
    expires_at: Date;
  }>(
    `SELECT id, code, attempts, expires_at FROM otp_codes
     WHERE email = $1 AND purpose = $2 AND consumed = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [email, opts.purpose],
  );
  const row = r.rows[0];

  if (!row) {
    return { ok: false, error: "请先获取验证码", remaining: 0 };
  }
  if (row.expires_at.getTime() < Date.now()) {
    await db.query(`DELETE FROM otp_codes WHERE id = $1`, [row.id]);
    return { ok: false, error: "验证码已过期，请重新获取", remaining: 0 };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await db.query(`DELETE FROM otp_codes WHERE id = $1`, [row.id]);
    return { ok: false, error: "验证码已失效，请重新获取", remaining: 0 };
  }
  if (row.code !== opts.code) {
    const attempts = row.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      // 第三次错误：立即失效，必须重新获取
      await db.query(`DELETE FROM otp_codes WHERE id = $1`, [row.id]);
      return { ok: false, error: "验证码已失效，请重新获取", remaining: 0 };
    }
    await db.query(`UPDATE otp_codes SET attempts = $1 WHERE id = $2`, [
      attempts,
      row.id,
    ]);
    return {
      ok: false,
      error: `验证码错误，还可尝试 ${OTP_MAX_ATTEMPTS - attempts} 次`,
      remaining: OTP_MAX_ATTEMPTS - attempts,
    };
  }
  // 验证通过：一次性消费
  await db.query(`UPDATE otp_codes SET consumed = TRUE WHERE id = $1`, [row.id]);
  return { ok: true, remaining: OTP_MAX_ATTEMPTS };
}

export async function sendOtpMail(opts: {
  to: string;
  subject: string;
  text: string;
  /** HTML 版本：可选，传入后以 multipart/alternative 发送（优先展示 HTML） */
  html?: string;
}) {
  // 访客不发真实邮件：验证码已由调用方的响应体（guestOtpResponse）直接返回
  if (isGuestEmail(opts.to)) return;
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    ...(opts.html ? { html: opts.html } : {}),
  });
}

/* ================================================================
 * 一次性安全 token（email_change_token / password_change_token）
 * 短时有效 / 一次性 / 绑定 userId / 绑定 purpose
 * ================================================================ */

export async function createChangeToken(opts: {
  userId: string;
  type: "email_change" | "password_change";
  target?: string;
  payload?: Record<string, unknown>;
  ttlMinutes?: number;
}): Promise<string> {
  const id = randomUUID();
  const ttl = opts.ttlMinutes ?? 10;
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
  await db.query(
    `INSERT INTO account_changes (id, user_id, type, target, payload, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      opts.userId,
      opts.type,
      opts.target ?? null,
      JSON.stringify(opts.payload ?? {}),
      expiresAt,
    ],
  );
  return id;
}

export async function getChangeToken(
  token: string,
  userId: string,
  type: string,
): Promise<{
  id: string;
  type: string;
  target: string | null;
  payload: Record<string, unknown>;
  expires_at: Date;
} | null> {
  const r = await db.query<{
    id: string;
    type: string;
    target: string | null;
    payload: Record<string, unknown>;
    expires_at: Date;
  }>(
    `SELECT id, type, target, payload, expires_at FROM account_changes
     WHERE id = $1 AND user_id = $2 AND type = $3 AND consumed = FALSE AND expires_at > NOW()
     LIMIT 1`,
    [token, userId, type],
  );
  const row = r.rows[0];
  if (!row) return null;
  return row;
}

export async function consumeChangeToken(token: string, userId: string) {
  await db.query(
    `UPDATE account_changes SET consumed = TRUE WHERE id = $1 AND user_id = $2 AND consumed = FALSE`,
    [token, userId],
  );
}

// 当前用户版本号（用于多设备并发修改邮箱）
export async function getUserVersion(userId: string): Promise<number> {
  const r = await db.query<{ version: number }>(
    `SELECT version FROM "user" WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return Number(r.rows[0]?.version ?? 0);
}

// 多设备并发安全的邮箱更新：
// 只有当 email 仍等于 originalEmail 且 version 未变化时才执行，否则拒绝
export async function updateEmailWithVersion(opts: {
  userId: string;
  originalEmail: string;
  expectedVersion: number;
  newEmail: string;
}): Promise<boolean> {
  const r = await db.query(
    `UPDATE "user"
     SET email = $1, version = version + 1, "updatedAt" = NOW()
     WHERE id = $2 AND email = $3 AND version = $4`,
    [
      opts.newEmail.toLowerCase().trim(),
      opts.userId,
      opts.originalEmail.toLowerCase().trim(),
      opts.expectedVersion,
    ],
  );
  return (r.rowCount ?? 0) === 1;
}
