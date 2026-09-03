import { toChineseError } from "./auth-errors";

export type RegistrationErrorParamsByCode = {
  REGISTRATION_CLOSED: undefined;
  INVITE_REQUIRED: undefined;
  INVITE_INVALID: undefined;
  INVITE_FORMAT: undefined;
  REGISTRATION_OTP_RATE_LIMIT: undefined;
  REGISTRATION_RATE_LIMIT: undefined;
  REGISTRATION_FAILED: undefined;
  AUTH_REGISTRATION_REJECTED: { authCode: string | null };
};

export type RegistrationErrorCode = keyof RegistrationErrorParamsByCode;
export type RegistrationErrorParams<C extends RegistrationErrorCode> =
  RegistrationErrorParamsByCode[C];
type RegistrationErrorArgs<C extends RegistrationErrorCode> =
  RegistrationErrorParams<C> extends undefined
    ? []
    : [params: RegistrationErrorParams<C>];

type DefinitionTable = {
  [C in RegistrationErrorCode]: {
    status: number;
    copy: (params: RegistrationErrorParams<C>) => string;
  };
};

const DEFINITIONS: DefinitionTable = {
  REGISTRATION_CLOSED: {
    status: 403,
    copy: () => "当前未开放新账号注册",
  },
  INVITE_REQUIRED: { status: 400, copy: () => "请输入邀请码" },
  INVITE_INVALID: { status: 400, copy: () => "邀请码无效或已撤销" },
  INVITE_FORMAT: { status: 400, copy: () => "请输入 6 位邀请码" },
  REGISTRATION_OTP_RATE_LIMIT: {
    status: 429,
    copy: () => "验证码发送过于频繁，请稍后再试",
  },
  REGISTRATION_RATE_LIMIT: {
    status: 429,
    copy: () => "操作过于频繁，请稍后再试",
  },
  REGISTRATION_FAILED: {
    status: 500,
    copy: () => "注册失败，请稍后重试",
  },
  AUTH_REGISTRATION_REJECTED: {
    status: 400,
    copy: ({ authCode }) =>
      toChineseError(authCode ? { code: authCode } : undefined),
  },
};

function paramsFromArgs<C extends RegistrationErrorCode>(
  args: RegistrationErrorArgs<C>,
): RegistrationErrorParams<C> {
  return args[0] as RegistrationErrorParams<C>;
}

/** 注册与邀请码领域文案唯一出口。 */
export function registrationErrorCopy<C extends RegistrationErrorCode>(
  code: C,
  ...args: RegistrationErrorArgs<C>
): string {
  return DEFINITIONS[code].copy(paramsFromArgs(args));
}

/** 注册领域异常，只携带稳定错误码和强类型参数。 */
export class RegistrationError<
  C extends RegistrationErrorCode = RegistrationErrorCode,
> extends Error {
  readonly code: C;
  readonly params: RegistrationErrorParams<C>;

  constructor(code: C, ...args: RegistrationErrorArgs<C>) {
    super(`registration rejected: ${code}`);
    this.name = new.target.name;
    this.code = code;
    this.params = paramsFromArgs(args);
  }
}

function copyFor<C extends RegistrationErrorCode>(
  code: C,
  params: RegistrationErrorParams<C>,
): string {
  return DEFINITIONS[code].copy(params);
}

/** 将注册领域错误映射为 HTTP 响应。 */
export function registrationErrorResponse(error: RegistrationError): Response {
  const definition = DEFINITIONS[error.code];
  const copy = copyFor(
    error.code,
    error.params as RegistrationErrorParams<typeof error.code>,
  );
  return Response.json(
    {
      error: copy,
      ...(error.code.startsWith("INVITE_") ? { code: error.code } : {}),
    },
    { status: definition.status },
  );
}
