import type { PoolClient } from "pg";
import { db } from "@/infrastructure/database/client";
import { internalAuthProof, verifyInternalAuthProof } from "@/infrastructure/security/internal-auth-proof";

export type RegistrationPolicy = {
  enabled: boolean;
  inviteRequired: boolean;
};

type RegistrationPolicyRow = {
  registration_enabled: boolean;
  invite_required: boolean;
};

/** 读取数据库中的实时注册策略；表中只有一条受约束的 singleton 记录。 */
export async function getRegistrationPolicy(
  client: Pick<PoolClient, "query"> = db,
): Promise<RegistrationPolicy> {
  const result = await client.query<RegistrationPolicyRow>(
    `SELECT registration_enabled, invite_required
     FROM registration_settings
     WHERE id = TRUE`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("registration settings singleton is missing");
  return {
    enabled: row.registration_enabled,
    inviteRequired: row.invite_required,
  };
}

/** 原子更新注册策略，并让数据库约束拒绝无效组合。 */
export async function updateRegistrationPolicy(input: {
  enabled: boolean;
  inviteRequired: boolean;
  updatedBy: string;
}): Promise<RegistrationPolicy> {
  const result = await db.query<RegistrationPolicyRow>(
    `UPDATE registration_settings
     SET registration_enabled = $1,
         invite_required = $2,
         updated_by = $3,
         updated_at = NOW()
     WHERE id = TRUE
     RETURNING registration_enabled, invite_required`,
    [input.enabled, input.enabled && input.inviteRequired, input.updatedBy],
  );
  const row = result.rows[0];
  if (!row) throw new Error("registration settings singleton is missing");
  return {
    enabled: row.registration_enabled,
    inviteRequired: row.invite_required,
  };
}

/** 仅在自建注册流程内部生成的 auth-handler proof。 */
export function registrationInternalProof(email: string): string {
  return internalAuthProof("registration", email.trim().toLowerCase());
}

export function verifyRegistrationInternalProof(
  email: string,
  proof: string | null | undefined,
): boolean {
  return verifyInternalAuthProof(
    "registration",
    email.trim().toLowerCase(),
    proof,
  );
}
