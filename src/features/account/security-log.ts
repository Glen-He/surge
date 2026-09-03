import { db } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/logging/logger";

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
    logger.error("security-log", "failed to write security log", err as Error);
  }
}
