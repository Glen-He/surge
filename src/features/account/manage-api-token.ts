import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { logger } from "@/infrastructure/logging/logger";
import {
  createApiToken,
  revokeCurrentApiToken,
  rotateApiToken,
  type ApiTokenInfo,
} from "./api-tokens";
import { ApiTokenManagementError } from "./api-token-errors";

type ApiTokenMutation = "create" | "rotate" | "revoke";

/** 执行账号页的 API 令牌变更，并统一处理限流和领域错误。 */
export async function mutateApiToken(input: {
  userId: string;
  email: string;
  clientIp: string;
  mutation: ApiTokenMutation;
}): Promise<ApiTokenInfo | null> {
  const rate = await consumeSharedRateLimit(
    "api-token-mutate",
    input.userId,
    30,
    10 * 60,
  );
  if (!rate.allowed) {
    logger.warn("api-token", "token action rate limited", {
      action: input.mutation,
      userId: input.userId,
      ip: input.clientIp,
    });
    throw new ApiTokenManagementError("TOKEN_MUTATION_RATE_LIMIT");
  }

  if (input.mutation === "revoke") {
    if (!(await revokeCurrentApiToken(input.userId))) {
      throw new ApiTokenManagementError("TOKEN_NOT_FOUND");
    }
    return null;
  }

  const result =
    input.mutation === "create"
      ? await createApiToken(input.userId, input.email)
      : await rotateApiToken(input.userId, input.email);
  if ("errorCode" in result) {
    throw new ApiTokenManagementError(result.errorCode);
  }
  return result.token;
}
