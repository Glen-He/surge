export type AccountInvitationErrorCode =
  | "INVITATION_GUEST_UNSUPPORTED"
  | "INVITATION_ALREADY_EXISTS"
  | "INVITATION_MUTATION_RATE_LIMIT"
  | "INVITATION_MUTATION_FAILED"
  | "INVITATION_NOT_FOUND";

const DEFINITIONS: Record<
  AccountInvitationErrorCode,
  { status: number; copy: string }
> = {
  INVITATION_GUEST_UNSUPPORTED: {
    status: 403,
    copy: "游客模式不支持邀请用户，注册正式账号后可用",
  },
  INVITATION_ALREADY_EXISTS: {
    status: 409,
    copy: "已有邀请码，可直接更换或撤销",
  },
  INVITATION_MUTATION_RATE_LIMIT: {
    status: 429,
    copy: "邀请码操作过于频繁，请稍后再试",
  },
  INVITATION_MUTATION_FAILED: {
    status: 500,
    copy: "邀请码生成失败，请稍后重试",
  },
  INVITATION_NOT_FOUND: {
    status: 404,
    copy: "没有可撤销的邀请码",
  },
};

export const INVITATION_UNREADABLE_COPY =
  "邀请码无法显示，请更换后重新生成";

/** 账号邀请码管理异常，只携带稳定错误码。 */
export class AccountInvitationError extends Error {
  constructor(readonly code: AccountInvitationErrorCode) {
    super(`account invitation operation rejected: ${code}`);
    this.name = new.target.name;
  }
}

/** 将账号邀请码管理错误映射为 HTTP 响应。 */
export function accountInvitationErrorResponse(
  error: AccountInvitationError,
): Response {
  const definition = DEFINITIONS[error.code];
  return Response.json(
    { error: definition.copy },
    { status: definition.status },
  );
}
