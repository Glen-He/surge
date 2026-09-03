import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { serverEnv } from "@/infrastructure/environment/server";
import { db } from "@/infrastructure/database/client";
import { isOtpCode, OTP_CODE_LENGTH } from "@/features/auth/otp-code";
import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

/* ================================================================
 * 自管 OTP（修改邮箱 / 修改密码使用）
 * 规则：6 位数字 / 5 分钟有效 / 最多错 3 次 / 一次性
 * ================================================================ */

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;

function otpSecret(): string {
  // OTP_SECRET 可选；留空从 BETTER_AUTH_SECRET 派生（均为 32+ 密钥）
  return serverEnv.OTP_SECRET ?? serverEnv.BETTER_AUTH_SECRET;
}

function hashOtp(email: string, purpose: string, code: string): string {
  return createHmac("sha256", otpSecret())
    .update(`${email}:${purpose}:${code}`)
    .digest("hex");
}

export async function generateAndStoreOtp(opts: {
  email: string;
  purpose: string;
}): Promise<string> {
  const code = String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(
    OTP_CODE_LENGTH,
    "0",
  );
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  const email = opts.email.toLowerCase().trim();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`otp-code:${email}:${opts.purpose}`],
    );
    await client.query(`DELETE FROM otp_codes WHERE email = $1 AND purpose = $2`, [
      email,
      opts.purpose,
    ]);
    await client.query(
      `INSERT INTO otp_codes (id, email, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), email, opts.purpose, hashOtp(email, opts.purpose, code), expiresAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
  // 格式错误不进入核销事务，也不消耗用户的验证码尝试次数。
  if (!isOtpCode(opts.code)) {
    return {
      ok: false,
      error: OTP_CODE_FORMAT_ERROR,
      remaining: OTP_MAX_ATTEMPTS,
    };
  }
  const email = opts.email.toLowerCase().trim();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{
      id: string;
      code_hash: string;
      attempts: number;
      expires_at: Date;
    }>(
      `SELECT id, code_hash, attempts, expires_at FROM otp_codes
       WHERE email = $1 AND purpose = $2 AND consumed = FALSE
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [email, opts.purpose],
    );
    const row = r.rows[0];

    if (!row) {
      await client.query("COMMIT");
      return { ok: false, error: "请先获取验证码", remaining: 0 };
    }
    if (row.expires_at.getTime() < Date.now() || row.attempts >= OTP_MAX_ATTEMPTS) {
      await client.query(`DELETE FROM otp_codes WHERE id = $1`, [row.id]);
      await client.query("COMMIT");
      return { ok: false, error: "验证码已失效，请重新获取", remaining: 0 };
    }
    const got = Buffer.from(hashOtp(email, opts.purpose, opts.code), "hex");
    const expected = Buffer.from(row.code_hash, "hex");
    const valid =
      got.length === expected.length && timingSafeEqual(got, expected);
    if (!valid) {
      const attempts = row.attempts + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await client.query(`DELETE FROM otp_codes WHERE id = $1`, [row.id]);
        await client.query("COMMIT");
        return { ok: false, error: "验证码已失效，请重新获取", remaining: 0 };
      }
      await client.query(`UPDATE otp_codes SET attempts = $1 WHERE id = $2`, [
        attempts,
        row.id,
      ]);
      await client.query("COMMIT");
      return {
        ok: false,
        error: `验证码错误，还可尝试 ${OTP_MAX_ATTEMPTS - attempts} 次`,
        remaining: OTP_MAX_ATTEMPTS - attempts,
      };
    }
    await client.query(`UPDATE otp_codes SET consumed = TRUE WHERE id = $1`, [row.id]);
    await client.query("COMMIT");
    return { ok: true, remaining: OTP_MAX_ATTEMPTS };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
