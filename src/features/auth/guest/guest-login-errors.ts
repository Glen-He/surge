export type GuestLoginErrorCode =
  | "GUEST_LOGIN_RATE_LIMIT"
  | "GUEST_AUTH_RATE_LIMIT"
  | "GUEST_LOGIN_UNAVAILABLE";

const DEFINITIONS: Record<
  GuestLoginErrorCode,
  { status: number; copy: string }
> = {
  GUEST_LOGIN_RATE_LIMIT: {
    status: 429,
    copy: "游客登录过于频繁，请稍后再试",
  },
  GUEST_AUTH_RATE_LIMIT: {
    status: 429,
    copy: "游客登录失败，请稍后重试",
  },
  GUEST_LOGIN_UNAVAILABLE: {
    status: 503,
    copy: "游客登录失败，请稍后重试",
  },
};

/** 游客登录领域异常，只携带稳定错误码。 */
export class GuestLoginError extends Error {
  constructor(readonly code: GuestLoginErrorCode) {
    super(`guest login rejected: ${code}`);
    this.name = new.target.name;
  }
}

/** 将游客登录错误映射为 HTTP 响应。 */
export function guestLoginErrorResponse(error: GuestLoginError): Response {
  const definition = DEFINITIONS[error.code];
  return Response.json(
    { error: definition.copy },
    { status: definition.status },
  );
}
