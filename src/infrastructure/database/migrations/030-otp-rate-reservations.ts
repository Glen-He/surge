import type { Migration } from "./migration";

export const OTP_RATE_RESERVATIONS: Migration = {
  version: 30,
  name: "otp-rate-reservations",
  statements: [
    `CREATE TABLE otp_rate_reservations (email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX otp_rate_reservations_email_created ON otp_rate_reservations (email, created_at DESC)`,
    `CREATE INDEX otp_rate_reservations_created ON otp_rate_reservations (created_at)`,
    // 保留当前冷却和当日配额，不因升级重置发信额度。
    `INSERT INTO otp_rate_reservations (email, created_at)
       SELECT lower(trim(email)), created_at FROM security_logs
        WHERE action = 'OTP_RATE_RESERVED' AND email IS NOT NULL
          AND created_at >= LEAST(date_trunc('day', NOW()), NOW() - INTERVAL '60 seconds')`,
    `DELETE FROM security_logs WHERE action = 'OTP_RATE_RESERVED'`,
  ],
};
