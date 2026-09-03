
// 版本化数据库迁移：
// - schema_migrations 表记录已应用版本；每个版本在事务内执行并登记，只跑一次
// - 版本 1 为基线（全部 IF NOT EXISTS 幂等语句）：存量库执行时无副作用、仅登记
//   版本；全新库则一次建齐。此后结构变更一律追加新版本，不再依赖幂等重放
// - pg_advisory_lock 防止多实例并发迁移（同库多进程同时启动的场景）
//
// 新增迁移示例：
//   1. 新建 027-xxx.ts 导出 Migration；2. 在下方 MIGRATIONS 按版本序追加。
//   statements 一经发布不可修改（schema_migrations.checksum 会拒绝）。

import { createHash } from "node:crypto";
import { db } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/logging/logger";
import type { Migration } from "./migration";
import { BASELINE } from "./001-baseline";
import { API_TOKENS } from "./002-api-tokens";
import { API_TOKEN_ENC } from "./003-api-token-enc";
import { API_TOKEN_DROP_HASH } from "./004-api-token-drop-hash";
import { REPORT_REVISION } from "./005-report-revision";
import { REPORT_CAP_EPOCH } from "./006-report-capability-epoch";
import { API_TOKEN_LOOKUP } from "./007-api-token-lookup";
import { OTP_HASH } from "./008-otp-hash";
import { SECURITY_RATE_LIMITS } from "./009-security-rate-limits";
import { REPORT_STORAGE_ACCOUNTING } from "./010-report-storage-accounting";
import { API_TOKEN_HASH_ONLY } from "./011-api-token-hash-only";
import { SHARE_BOARDS } from "./012-share-boards";
import { REPORT_TEMPLATE_REFERENCE } from "./013-report-template-reference";
import { IMMUTABLE_REPORT_STORAGE } from "./014-immutable-report-storage";
import { RETENTION_CLEANUP_INDEXES } from "./015-retention-cleanup-indexes";
import { SHARE_CREDENTIAL_HARDENING } from "./016-share-credential-hardening";
import { MAINTENANCE_STATE } from "./017-maintenance-state";
import { SHARE_PASSCODE_RECOVERY } from "./020-share-passcode-recovery";
import { REPORT_CONTENT_SOURCE_REQUIRED } from "./021-report-content-source-required";
import { FINAL_RUNTIME_INVARIANTS } from "./022-final-runtime-invariants";
import { REMOVE_DEVELOPMENT_COMPATIBILITY } from "./023-remove-development-compatibility";
import { REMOVE_REPORT_EXTERNAL_NETWORK } from "./024-remove-report-external-network";
import { REGISTRATION_ADMIN } from "./025-registration-admin";
import { SINGLE_INVITE_AND_VISIBLE_API_TOKEN } from "./026-single-invite-and-visible-api-token";

const MIGRATIONS: Migration[] = [
  BASELINE,
  API_TOKENS,
  API_TOKEN_ENC,
  API_TOKEN_DROP_HASH,
  REPORT_REVISION,
  REPORT_CAP_EPOCH,
  API_TOKEN_LOOKUP,
  OTP_HASH,
  SECURITY_RATE_LIMITS,
  REPORT_STORAGE_ACCOUNTING,
  API_TOKEN_HASH_ONLY,
  SHARE_BOARDS,
  REPORT_TEMPLATE_REFERENCE,
  IMMUTABLE_REPORT_STORAGE,
  RETENTION_CLEANUP_INDEXES,
  SHARE_CREDENTIAL_HARDENING,
  MAINTENANCE_STATE,
  SHARE_PASSCODE_RECOVERY,
  REPORT_CONTENT_SOURCE_REQUIRED,
  FINAL_RUNTIME_INVARIANTS,
  REMOVE_DEVELOPMENT_COMPATIBILITY,
  REMOVE_REPORT_EXTERNAL_NETWORK,
  REGISTRATION_ADMIN,
  SINGLE_INVITE_AND_VISIBLE_API_TOKEN,
];

// 专用 advisory lock key（0x53555247 = "SURG"），避免与其他应用碰撞
const ADVISORY_LOCK_KEY = 0x53555247;

let ran: Promise<void> | null = null;

async function run(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const { rows } = await client.query<{ version: number; name: string; checksum: string | null }>(
      "SELECT version, name, checksum FROM schema_migrations",
    );
    const done = new Map(rows.map((r) => [r.version, r]));

    for (const m of MIGRATIONS) {
      const checksum = createHash("sha256")
        .update(m.name)
        .update("\0")
        .update(m.statements.join("\0"))
        .digest("hex");
      const existing = done.get(m.version);
      if (existing) {
        if (existing.name !== m.name) {
          throw new Error(`migration v${m.version} name changed`);
        }
        if (existing.checksum && existing.checksum !== checksum) {
          throw new Error(
            `migration v${m.version} content changed; applied migrations must stay immutable`,
          );
        }
        if (!existing.checksum) {
          await client.query(
            "UPDATE schema_migrations SET checksum = $2 WHERE version = $1 AND checksum IS NULL",
            [m.version, checksum],
          );
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        for (const sql of m.statements) await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [m.version, m.name, checksum],
        );
        await client.query("COMMIT");
        logger.info("migrations", "migration applied", {
          version: m.version,
          name: m.name,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
}

/** 确保迁移已全部应用（进程内单次；失败可重试）。 */
export function ensureSchemaVersioned(): Promise<void> {
  if (!ran) {
    ran = run().catch((err) => {
      ran = null; // 失败不缓存，下次调用重试
      throw err;
    });
  }
  return ran;
}
