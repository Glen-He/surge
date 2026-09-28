import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";

export type AccountVerificationErrorParamsByCode = {
  OTP_FORMAT_INVALID: undefined;
  OTP_REQUIRED: undefined;
  OTP_EXPIRED: undefined;
  OTP_INCORRECT: { remaining: number };
  ACCOUNT_CHANGED: undefined;
  PASSWORD_REQUIRED: undefined;
  PASSWORD_INCORRECT: undefined;
  PASSWORD_VERIFY_RATE_LIMIT: { retryAfter: number };
  ACCOUNT_OTP_SEND_FAILED: undefined;
  OTP_DAILY_LIMIT: { retryAfter: number };
  OTP_COOLDOWN: { retryAfter: number };
  EMAIL_CHANGE_PROOF_REQUIRED: undefined;
  EMAIL_INVALID: undefined;
  EMAIL_CHANGE_PROOF_EXPIRED: undefined;
  EMAIL_UNCHANGED: undefined;
  GUEST_EMAIL_DOMAIN_REQUIRED: { domain: string };
  EMAIL_ALREADY_USED: undefined;
};

export type AccountVerificationErrorCode = keyof AccountVerificationErrorParamsByCode;
export type AccountVerificationErrorParams<C extends AccountVerificationErrorCode> =
  AccountVerificationErrorParamsByCode[C];
type AccountVerificationErrorArgs<C extends AccountVerificationErrorCode> =
  AccountVerificationErrorParams<C> extends undefined ? [] : [AccountVerificationErrorParams<C>];

type DefinitionTable = {
  [C in AccountVerificationErrorCode]: {
    status: number;
    copy: (params: AccountVerificationErrorParams<C>) => string;
  };
};

const DEFINITIONS: DefinitionTable = {
  OTP_FORMAT_INVALID: { status: 400, copy: () => OTP_CODE_FORMAT_ERROR },
  OTP_REQUIRED: { status: 400, copy: () => "请先获取验证码" },
  OTP_EXPIRED: { status: 400, copy: () => "验证码已失效，请重新获取" },
  OTP_INCORRECT: { status: 400, copy: ({ remaining }) => `验证码错误，还可尝试 ${remaining} 次` },
  ACCOUNT_CHANGED: { status: 409, copy: () => "账号信息已经发生变化，请重新验证后再试" },
  PASSWORD_REQUIRED: { status: 400, copy: () => "请输入当前密码" },
  PASSWORD_INCORRECT: { status: 400, copy: () => "当前密码错误" },
  PASSWORD_VERIFY_RATE_LIMIT: { status: 429, copy: ({ retryAfter }) => `尝试次数过多，请 ${retryAfter} 秒后再试` },
  ACCOUNT_OTP_SEND_FAILED: {
    status: 500,
    copy: () => "验证码发送失败，请稍后重试",
  },
  OTP_DAILY_LIMIT: {
    status: 429,
    copy: () => "今日验证码发送次数已达上限，请明天再试",
  },
  OTP_COOLDOWN: {
    status: 429,
    copy: ({ retryAfter }) => `请 ${retryAfter} 秒后再试`,
  },
  EMAIL_CHANGE_PROOF_REQUIRED: {
    status: 400,
    copy: () => "请先验证当前邮箱",
  },
  EMAIL_INVALID: {
    status: 400,
    copy: () => "邮箱格式不正确",
  },
  EMAIL_CHANGE_PROOF_EXPIRED: {
    status: 400,
    copy: () => "验证已过期，请重新开始",
  },
  EMAIL_UNCHANGED: {
    status: 400,
    copy: () => "新邮箱不能与当前邮箱相同",
  },
  GUEST_EMAIL_DOMAIN_REQUIRED: {
    status: 400,
    copy: ({ domain }) => `游客模式暂不支持修改为真实邮箱，新邮箱需为 @${domain} 域名`,
  },
  EMAIL_ALREADY_USED: {
    status: 400,
    copy: () => "该邮箱已被其他账号使用",
  },
};

/** 账号身份验证领域异常，只携带稳定错误码和强类型参数。 */
export class AccountVerificationError<
  C extends AccountVerificationErrorCode = AccountVerificationErrorCode,
> extends Error {
  readonly code: C;
  readonly params: AccountVerificationErrorParams<C>;

  constructor(code: C, ...args: AccountVerificationErrorArgs<C>) {
    super(`account verification rejected: ${code}`);
    this.name = new.target.name;
    this.code = code;
    this.params = args[0] as AccountVerificationErrorParams<C>;
  }
}

function copyFor<C extends AccountVerificationErrorCode>(
  code: C,
  params: AccountVerificationErrorParams<C>,
): string {
  return DEFINITIONS[code].copy(params);
}

/** 将账号身份验证领域错误映射为 HTTP 响应。 */
export function accountVerificationErrorResponse(error: AccountVerificationError): Response {
  const definition = DEFINITIONS[error.code];
  const copy = copyFor(
    error.code,
    error.params as AccountVerificationErrorParams<typeof error.code>,
  );
  const body: { error: string; code?: string; retryAfter?: number } = {
    error: copy,
  };
  if (error.code === "OTP_DAILY_LIMIT" || error.code === "OTP_COOLDOWN") {
    body.code = error.code;
  }
  if (error.code === "OTP_DAILY_LIMIT" || error.code === "OTP_COOLDOWN") {
    body.retryAfter = (
      error.params as AccountVerificationErrorParams<
        "OTP_DAILY_LIMIT" | "OTP_COOLDOWN"
      >
    ).retryAfter;
  }
  return Response.json(body, { status: definition.status });
}
