import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { logger } from "@/infrastructure/logging/logger";
import { isGuestEmail } from "@/features/auth/guest/guest-identity";
import {
  createRegistrationInvite,
  getRegistrationInvite,
  revokeRegistrationInvite,
  rotateRegistrationInvite,
  type InviteSummary,
} from "@/features/auth/registration-invites";
import { logSecurity } from "@/features/security-audit/security-log";
import { AccountInvitationError } from "./invitation-errors";

type InvitationMutation = "create" | "rotate" | "revoke";

const AUDIT_ACTION: Record<InvitationMutation, string> = {
  create: "REGISTRATION_INVITE_CREATED",
  rotate: "REGISTRATION_INVITE_ROTATED",
  revoke: "REGISTRATION_INVITE_REVOKED",
};

function assertEligible(email: string): void {
  if (isGuestEmail(email)) {
    throw new AccountInvitationError("INVITATION_GUEST_UNSUPPORTED");
  }
}

/** 读取正式账号当前的邀请码。 */
export async function getAccountInvitation(input: {
  userId: string;
  email: string;
}): Promise<InviteSummary | null> {
  assertEligible(input.email);
  return getRegistrationInvite(input.userId);
}

/** 执行邀请码创建、更换或撤销，并统一处理限流与安全审计。 */
export async function mutateAccountInvitation(input: {
  userId: string;
  email: string;
  clientIp: string;
  mutation: InvitationMutation;
}): Promise<{ invite: InviteSummary } | { ok: true }> {
  assertEligible(input.email);
  const rate = await consumeSharedRateLimit(
    "registration-invite-mutate",
    input.userId,
    30,
    10 * 60,
  );
  if (!rate.allowed) {
    logger.warn("registration-invites", "invite action rate limited", {
      userId: input.userId,
      action: input.mutation,
      ip: input.clientIp,
    });
    throw new AccountInvitationError("INVITATION_MUTATION_RATE_LIMIT");
  }

  try {
    let result: { invite: InviteSummary } | { ok: true };
    if (input.mutation === "revoke") {
      if (!(await revokeRegistrationInvite(input.userId))) {
        throw new AccountInvitationError("INVITATION_NOT_FOUND");
      }
      result = { ok: true };
    } else {
      const mutationResult =
        input.mutation === "create"
          ? await createRegistrationInvite(input.userId)
          : await rotateRegistrationInvite(input.userId);
      if ("errorCode" in mutationResult) {
        throw new AccountInvitationError("INVITATION_ALREADY_EXISTS");
      }
      result = mutationResult;
    }

    await logSecurity({
      userId: input.userId,
      action: AUDIT_ACTION[input.mutation],
      ip: input.clientIp,
    });
    return result;
  } catch (error) {
    if (error instanceof AccountInvitationError) throw error;
    logger.error(
      "registration-invites",
      "failed to mutate registration invite",
      error as Error,
      {
        userId: input.userId,
        action: input.mutation,
        ip: input.clientIp,
      },
    );
    throw new AccountInvitationError("INVITATION_MUTATION_FAILED");
  }
}
