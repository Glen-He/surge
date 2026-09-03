import { randomUUID } from "crypto";
import { db } from "@/infrastructure/database/client";

type ChangeTokenType = "email_change" | "password_change";

/* ================================================================
 * 一次性安全 token（email_change_token / password_change_token）
 * 短时有效 / 一次性 / 绑定 userId / 绑定 purpose
 * ================================================================ */

export async function createChangeToken(opts: {
  userId: string;
  type: ChangeTokenType;
  payload?: Record<string, unknown>;
  ttlMinutes?: number;
}): Promise<string> {
  const id = randomUUID();
  const ttl = opts.ttlMinutes ?? 10;
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`account-change:${opts.userId}:${opts.type}`],
    );
    await client.query(
      `UPDATE account_changes SET consumed = TRUE
       WHERE user_id = $1 AND type = $2 AND consumed = FALSE`,
      [opts.userId, opts.type],
    );
    await client.query(
      `INSERT INTO account_changes (id, user_id, type, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        opts.userId,
        opts.type,
        JSON.stringify(opts.payload ?? {}),
        expiresAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return id;
}

export async function getChangeToken(
  token: string,
  userId: string,
  type: ChangeTokenType,
): Promise<{
  id: string;
  type: ChangeTokenType;
  payload: Record<string, unknown>;
  expires_at: Date;
} | null> {
  const r = await db.query<{
    id: string;
    type: ChangeTokenType;
    payload: Record<string, unknown>;
    expires_at: Date;
  }>(
    `SELECT id, type, payload, expires_at FROM account_changes
     WHERE id = $1 AND user_id = $2 AND type = $3 AND consumed = FALSE AND expires_at > NOW()
     LIMIT 1`,
    [token, userId, type],
  );
  const row = r.rows[0];
  if (!row) return null;
  return row;
}

/**
 * 原子地消费身份凭证、更新密码并撤销其余全部会话。
 * 因此一次成功响应绝不会因为后续尽力而为的调用失败，
 * 而留下一个被盗会话仍处于活跃状态。
 */
export async function completePasswordChange(opts: {
  token: string;
  userId: string;
  currentSessionId: string;
  passwordHash: string;
}): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`credential-change:${opts.userId}`],
    );
    const proof = await client.query(
      `UPDATE account_changes SET consumed = TRUE
       WHERE id = $1 AND user_id = $2 AND type = 'password_change'
         AND consumed = FALSE AND expires_at > NOW()`,
      [opts.token, opts.userId],
    );
    if (proof.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    const credential = await client.query(
      `UPDATE account SET password = $2, "updatedAt" = NOW()
       WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [opts.userId, opts.passwordHash],
    );
    if (credential.rowCount !== 1) {
      throw new Error("credential account missing during password change");
    }
    await client.query(
      `DELETE FROM "session" WHERE "userId" = $1 AND id <> $2`,
      [opts.userId, opts.currentSessionId],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** 在同一事务内完成邮箱变更并撤销其余会话 */
export async function completeEmailChange(opts: {
  token: string;
  userId: string;
  currentSessionId: string;
  originalEmail: string;
  expectedVersion: number;
  newEmail: string;
}): Promise<"ok" | "invalid-proof" | "conflict"> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`credential-change:${opts.userId}`],
    );
    const proof = await client.query(
      `UPDATE account_changes SET consumed = TRUE
       WHERE id = $1 AND user_id = $2 AND type = 'email_change'
         AND consumed = FALSE AND expires_at > NOW()`,
      [opts.token, opts.userId],
    );
    if (proof.rowCount !== 1) {
      await client.query("ROLLBACK");
      return "invalid-proof";
    }
    const updated = await client.query(
      `UPDATE "user"
       SET email = $1, version = version + 1, "updatedAt" = NOW()
       WHERE id = $2 AND lower(email) = lower($3) AND version = $4`,
      [opts.newEmail, opts.userId, opts.originalEmail, opts.expectedVersion],
    );
    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return "conflict";
    }
    await client.query(
      `DELETE FROM "session" WHERE "userId" = $1 AND id <> $2`,
      [opts.userId, opts.currentSessionId],
    );
    await client.query("COMMIT");
    return "ok";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// 当前用户版本号（用于多设备并发修改邮箱）
export async function getUserVersion(userId: string): Promise<number> {
  const r = await db.query<{ version: number }>(
    `SELECT version FROM "user" WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return Number(r.rows[0]?.version ?? 0);
}
