import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";
import { db } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/logging/logger";
import {
  decryptInviteCode,
  encryptInviteCode,
  inviteCodeHash,
} from "@/features/auth/invite-code-credentials";

const INVITE_CODE_LENGTH = 6;
export const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase();
}

export function inviteCodeHasValidFormat(value: string): boolean {
  return /^[0-9A-Z]{6}$/.test(normalizeInviteCode(value));
}

export function inviteCodeLookup(value: string): string {
  return inviteCodeHash(normalizeInviteCode(value));
}

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export type InviteSummary = {
  id: string;
  code: string | null;
  useCount: number;
  disabledAt: string | null;
};

type InviteRow = {
  id: string;
  code_enc: string;
  use_count: number;
  disabled_at: Date | null;
};

function toInviteSummary(row: InviteRow): InviteSummary {
  let code: string | null = null;
  try {
    code = decryptInviteCode(row.code_enc);
  } catch (error) {
    logger.error(
      "registration-invites",
      "failed to decrypt registration invite",
      error as Error,
      { inviteId: row.id },
    );
  }
  return {
    id: row.id,
    code,
    useCount: row.use_count,
    disabledAt: row.disabled_at?.toISOString() ?? null,
  };
}

/** 每个正式用户只有一条邀请码记录，撤销后仍保留累计邀请次数。 */
export async function getRegistrationInvite(
  createdBy: string,
): Promise<InviteSummary | null> {
  const result = await db.query<InviteRow>(
    `SELECT id, code_enc, use_count, disabled_at
     FROM registration_invites
     WHERE created_by = $1
     LIMIT 1`,
    [createdBy],
  );
  return result.rows[0] ? toInviteSummary(result.rows[0]) : null;
}

type InviteMutationResult =
  | { invite: InviteSummary }
  | { errorCode: "INVITE_ALREADY_EXISTS" };

async function writeRegistrationInvite(input: {
  createdBy: string;
  replaceExisting: boolean;
}): Promise<InviteMutationResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`registration-invite:${input.createdBy}`],
    );
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM registration_invites WHERE created_by = $1 LIMIT 1`,
      [input.createdBy],
    );
    if (existing.rows[0] && !input.replaceExisting) {
      await client.query("ROLLBACK");
      return { errorCode: "INVITE_ALREADY_EXISTS" };
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateInviteCode();
      const lookup = inviteCodeLookup(code);
      const encrypted = encryptInviteCode(code);
      await client.query("SAVEPOINT invite_code_attempt");
      let result: QueryResult<InviteRow>;
      try {
        result = existing.rows[0]
          ? await client.query<InviteRow>(
              `UPDATE registration_invites
               SET code_lookup = $1, code_enc = $2, disabled_at = NULL,
                   created_at = NOW()
               WHERE created_by = $3
               RETURNING id, code_enc, use_count, disabled_at`,
              [lookup, encrypted, input.createdBy],
            )
          : await client.query<InviteRow>(
              `INSERT INTO registration_invites
                 (id, code_lookup, code_enc, created_by)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING
               RETURNING id, code_enc, use_count, disabled_at`,
              [
                `ri_${randomUUID().replaceAll("-", "")}`,
                lookup,
                encrypted,
                input.createdBy,
              ],
            );
        await client.query("RELEASE SAVEPOINT invite_code_attempt");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT invite_code_attempt");
        await client.query("RELEASE SAVEPOINT invite_code_attempt");
        if ((error as { code?: string }).code === "23505") continue;
        throw error;
      }
      const row = result.rows[0];
      if (!row) continue;
      await client.query("COMMIT");
      return { invite: toInviteSummary(row) };
    }
    throw new Error("registration invite collision retry limit reached");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** 首次创建用户唯一的邀请码。 */
export function createRegistrationInvite(
  createdBy: string,
): Promise<InviteMutationResult> {
  return writeRegistrationInvite({ createdBy, replaceExisting: false });
}

/** 更换现有邀请码；没有记录时等价于首次创建。 */
export function rotateRegistrationInvite(
  createdBy: string,
): Promise<InviteMutationResult> {
  return writeRegistrationInvite({ createdBy, replaceExisting: true });
}

/** 只验证当前邀请码是否属于未撤销状态。 */
export async function validateRegistrationInvite(
  code: string,
  client: Pick<PoolClient, "query"> = db,
): Promise<{ id: string } | null> {
  if (!inviteCodeHasValidFormat(code)) return null;
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM registration_invites
     WHERE code_lookup = $1 AND disabled_at IS NULL
     LIMIT 1`,
    [inviteCodeLookup(code)],
  );
  return result.rows[0] ?? null;
}

/** 注册成功后累计一次邀请归因，并写入用户级唯一审计记录。 */
export async function redeemRegistrationInvite(input: {
  client: PoolClient;
  code: string;
  userId: string;
}): Promise<boolean> {
  if (!inviteCodeHasValidFormat(input.code)) return false;
  await input.client.query("BEGIN");
  try {
    const updated = await input.client.query<{ id: string }>(
      `UPDATE registration_invites
       SET use_count = use_count + 1
       WHERE code_lookup = $1 AND disabled_at IS NULL
       RETURNING id`,
      [inviteCodeLookup(input.code)],
    );
    const inviteId = updated.rows[0]?.id;
    if (!inviteId) {
      await input.client.query("ROLLBACK");
      return false;
    }
    await input.client.query(
      `INSERT INTO registration_invite_redemptions (id, invite_id, user_id)
       VALUES ($1, $2, $3)`,
      [`rir_${randomUUID().replaceAll("-", "")}`, inviteId, input.userId],
    );
    await input.client.query("COMMIT");
    return true;
  } catch (error) {
    await input.client.query("ROLLBACK").catch(() => {});
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
}

/** 撤销当前用户的邀请码，保留累计邀请次数供以后重新生成后继续统计。 */
export async function revokeRegistrationInvite(createdBy: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE registration_invites
     SET disabled_at = COALESCE(disabled_at, NOW())
     WHERE created_by = $1 AND disabled_at IS NULL
     RETURNING id`,
    [createdBy],
  );
  return (result.rowCount ?? 0) > 0;
}
