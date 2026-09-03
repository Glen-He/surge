export type AccountOtpErrorParamsByCode = {
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

export type AccountOtpErrorCode = keyof AccountOtpErrorParamsByCode;
export type AccountOtpErrorParams<C extends AccountOtpErrorCode> =
  AccountOtpErrorParamsByCode[C];
type AccountOtpErrorArgs<C extends AccountOtpErrorCode> =
  AccountOtpErrorParams<C> extends undefined ? [] : [AccountOtpErrorParams<C>];

type DefinitionTable = {
  [C in AccountOtpErrorCode]: {
    status: number;
    copy: (params: AccountOtpErrorParams<C>) => string;
  };
};

const DEFINITIONS: DefinitionTable = {
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

/** 账号验证码领域异常，只携带稳定错误码和强类型参数。 */
export class AccountOtpError<
  C extends AccountOtpErrorCode = AccountOtpErrorCode,
> extends Error {
  readonly code: C;
  readonly params: AccountOtpErrorParams<C>;

  constructor(code: C, ...args: AccountOtpErrorArgs<C>) {
    super(`account otp rejected: ${code}`);
    this.name = new.target.name;
    this.code = code;
    this.params = args[0] as AccountOtpErrorParams<C>;
  }
}

function copyFor<C extends AccountOtpErrorCode>(
  code: C,
  params: AccountOtpErrorParams<C>,
): string {
  return DEFINITIONS[code].copy(params);
}

/** 将账号验证码领域错误映射为 HTTP 响应。 */
export function accountOtpErrorResponse(error: AccountOtpError): Response {
  const definition = DEFINITIONS[error.code];
  const copy = copyFor(
    error.code,
    error.params as AccountOtpErrorParams<typeof error.code>,
  );
  const body: { error: string; code?: string; retryAfter?: number } = {
    error: copy,
  };
  if (error.code === "OTP_DAILY_LIMIT" || error.code === "OTP_COOLDOWN") {
    body.code = error.code;
  }
  if (error.code === "OTP_DAILY_LIMIT" || error.code === "OTP_COOLDOWN") {
    body.retryAfter = (
      error.params as AccountOtpErrorParams<
        "OTP_DAILY_LIMIT" | "OTP_COOLDOWN"
      >
    ).retryAfter;
  }
  return Response.json(body, { status: definition.status });
}
