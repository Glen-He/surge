import { db } from "@/infrastructure/database/client";
import { logSecurity } from "@/features/security-audit/security-log";

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

  // 游客与真实邮箱统一频控（60s 冷却 + 自然日 10 次）：
  // 游客虽不消耗 SMTP 配额，但接口层同样不能只靠前端按钮挡连点；
  // 每个游客 email 唯一，频控互不影响。
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`otp-rate:${email}`],
    );
    // 仅保留该邮箱当日自然日的频控预留行；
    // 长期审计事件使用不同的 action，不受此清理影响。
    await client.query(
      `DELETE FROM security_logs
       WHERE email = $1 AND action = 'OTP_RATE_RESERVED'
         AND created_at < date_trunc('day', NOW())`,
      [email],
    );
    const last = await client.query<{ created_at: Date }>(
      `SELECT created_at FROM security_logs
       WHERE email = $1 AND action = 'OTP_RATE_RESERVED'
       AND created_at > NOW() - INTERVAL '60 seconds'
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (last.rows[0]) {
      await client.query("COMMIT");
      const wait = Math.ceil(
        (last.rows[0].created_at.getTime() + 60_000 - Date.now()) / 1000,
      );
      return {
        ok: false,
        reason: "cooldown",
        retryAfter: Math.max(wait, 1),
      };
    }

    const r = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM security_logs
       WHERE email = $1 AND action = 'OTP_RATE_RESERVED'
       AND created_at >= date_trunc('day', NOW())`,
      [email],
    );
    const todayCount = Number(r.rows[0]?.count ?? 0);
    if (todayCount >= 10) {
      await client.query("COMMIT");
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      return {
        ok: false,
        reason: "daily_limit",
        retryAfter: Math.ceil((tomorrow.getTime() - Date.now()) / 1000),
      };
    }

    // 先占位再发信：发送失败也故意消耗名额，对重试风暴与
    // 邮件服务商故障保持失败关闭（fail closed）。
    await client.query(
      `INSERT INTO security_logs (action, email)
       VALUES ('OTP_RATE_RESERVED', $1)`,
      [email],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      retryAfter: 60,
      remainingToday: 9 - todayCount,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function recordOtpSent(email: string, action: string) {
  await logSecurity({ action, email });
}
