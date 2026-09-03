import type { Migration } from "./index";


// ── v8：OTP 脱敏存储 ──
// 6 位码不得明文落库。存量 OTP 最长仅 5 分钟，部署时直接作废，
// 避免在迁移中需要短暂接触明文或依赖应用密钥。
export const OTP_HASH: Migration = {
  version: 8,
  name: "otp-hash",
  statements: [
    `ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_hash TEXT`,
    `DELETE FROM otp_codes`,
    `ALTER TABLE otp_codes ALTER COLUMN code_hash SET NOT NULL`,
    `ALTER TABLE otp_codes DROP COLUMN IF EXISTS code`,
  ],
};
