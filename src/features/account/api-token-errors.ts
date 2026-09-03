import type { ApiTokenErrorCode } from "./api-tokens";

export type ApiTokenManagementErrorCode =
  | ApiTokenErrorCode
  | "TOKEN_MUTATION_RATE_LIMIT"
  | "TOKEN_NOT_FOUND";

const DEFINITIONS: Record<
  ApiTokenManagementErrorCode,
  { status: number; copy: string }
> = {
  GUEST_UNSUPPORTED: {
    status: 403,
    copy: "游客模式不支持 API 令牌，注册正式账号后可用",
  },
  TOKEN_ALREADY_EXISTS: {
    status: 409,
    copy: "已有令牌（每账号一个），可更换或撤销后重建",
  },
  TOKEN_MUTATION_RATE_LIMIT: {
    status: 429,
    copy: "操作过于频繁，请稍后再试",
  },
  TOKEN_NOT_FOUND: {
    status: 404,
    copy: "没有可撤销的令牌",
  },
};

export const API_TOKEN_UNREADABLE_COPY =
  "令牌无法显示，请更换或撤销后重新生成";

/** API 令牌管理异常，只携带稳定错误码。 */
export class ApiTokenManagementError extends Error {
  constructor(readonly code: ApiTokenManagementErrorCode) {
    super(`API token operation rejected: ${code}`);
    this.name = new.target.name;
  }
}

/** 将 API 令牌管理错误映射为 HTTP 响应。 */
export function apiTokenErrorResponse(
  error: ApiTokenManagementError,
): Response {
  const definition = DEFINITIONS[error.code];
  return Response.json(
    { error: definition.copy },
    { status: definition.status },
  );
}
