import { db } from "./db";
import { logger } from "./logger";

const ADVISORY_LOCK_KEY = "surge:better-auth-schema";
const CREDENTIAL_ISSUER = "local:credential";

let ran: Promise<void> | null = null;

async function migrateAccountIssuer(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      ADVISORY_LOCK_KEY,
    ]);
    const table = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('account') IS NOT NULL AS exists`,
    );
    if (!table.rows[0]?.exists) return;

    await client.query("BEGIN");
    try {
      let changed = false;
      const column = await client.query<{ is_nullable: "YES" | "NO" }>(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'account'
           AND column_name = 'issuer'`,
      );
      if (!column.rows[0]) {
        await client.query(`ALTER TABLE account ADD COLUMN issuer TEXT`);
        changed = true;
      }

      // 当前产品只启用 credential provider。其他 provider 的 issuer 必须来自
      // 其可信身份源，不能在通用迁移里根据 providerId 猜测后静默绑定。
      const unsupported = await client.query<{ provider_id: string }>(
        `SELECT DISTINCT "providerId" AS provider_id
         FROM account
         WHERE issuer IS NULL AND "providerId" <> 'credential'
         LIMIT 1`,
      );
      if (unsupported.rows[0]) {
        throw new Error(
          "Better Auth account issuer migration requires a reviewed provider mapping",
        );
      }

      const updated = await client.query(
        `UPDATE account
         SET issuer = $1
         WHERE issuer IS NULL AND "providerId" = 'credential'`,
        [CREDENTIAL_ISSUER],
      );
      changed ||= (updated.rowCount ?? 0) > 0;
      const invalid = await client.query<{ invalid: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM account
           WHERE issuer IS NULL
              OR ("providerId" = 'credential' AND issuer <> $1)
         ) AS invalid`,
        [CREDENTIAL_ISSUER],
      );
      if (invalid.rows[0]?.invalid) {
        throw new Error("Better Auth account issuer migration is incomplete");
      }

      if (!column.rows[0] || column.rows[0].is_nullable === "YES") {
        await client.query(`ALTER TABLE account ALTER COLUMN issuer SET NOT NULL`);
        changed = true;
      }
      await client.query("COMMIT");
      if (changed) {
        logger.info("better-auth-migration", "account issuer migration applied");
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        ADVISORY_LOCK_KEY,
      ])
      .catch(() => {});
    client.release();
  }
}

/** 在 Better Auth 1.7 自身迁移前完成必须的数据语义回填。 */
export function ensureBetterAuthSchemaCompatible(): Promise<void> {
  if (!ran) {
    ran = migrateAccountIssuer().catch((error) => {
      ran = null;
      throw error;
    });
  }
  return ran;
}
