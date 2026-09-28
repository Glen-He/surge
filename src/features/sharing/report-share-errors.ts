export type ReportShareErrorParamsByCode = {
  SHARE_GUEST_FORBIDDEN: undefined;
  SHARE_PASSCODE_INVALID: undefined;
  SHARE_EXPIRY_INVALID: undefined;
  SHARE_PASSWORD_SETTING_INVALID: undefined;
  SHARE_DISABLED_INVALID: undefined;
  SHARE_NO_CHANGES: undefined;
  SHARE_REPORT_NOT_FOUND: undefined;
  SHARE_LIMIT_REACHED: { max: number };
  SHARE_NOT_FOUND: undefined;
};

export type ReportShareErrorCode = keyof ReportShareErrorParamsByCode;
export type ReportShareErrorParams<C extends ReportShareErrorCode> =
  ReportShareErrorParamsByCode[C];
type ReportShareErrorArgs<C extends ReportShareErrorCode> =
  ReportShareErrorParams<C> extends undefined
    ? []
    : [params: ReportShareErrorParams<C>];

type DefinitionTable = {
  [C in ReportShareErrorCode]: {
    status: number;
    copy: (params: ReportShareErrorParams<C>) => string;
  };
};

const DEFINITIONS: DefinitionTable = {
  SHARE_GUEST_FORBIDDEN: { status: 403, copy: () => "游客模式不支持分享" },
  SHARE_PASSCODE_INVALID: {
    status: 400,
    copy: () => "提取码必须是 4 位字母或数字",
  },
  SHARE_EXPIRY_INVALID: {
    status: 400,
    copy: () => "无效的有效期",
  },
  SHARE_PASSWORD_SETTING_INVALID: {
    status: 400,
    copy: () => "无效的密码设置",
  },
  SHARE_DISABLED_INVALID: {
    status: 400,
    copy: () => "无效的启停设置",
  },
  SHARE_NO_CHANGES: {
    status: 400,
    copy: () => "没有可更新的内容",
  },
  SHARE_REPORT_NOT_FOUND: {
    status: 404,
    copy: () => "报告不存在",
  },
  SHARE_LIMIT_REACHED: {
    status: 400,
    copy: ({ max }) => `最多 ${max} 条分享链接，撤销旧链接后可再次创建`,
  },
  SHARE_NOT_FOUND: {
    status: 404,
    copy: () => "分享不存在",
  },
};

/** 分享链接领域异常，只携带错误码和强类型参数。 */
export class ReportShareError<
  C extends ReportShareErrorCode = ReportShareErrorCode,
> extends Error {
  readonly code: C;
  readonly params: ReportShareErrorParams<C>;

  constructor(code: C, ...args: ReportShareErrorArgs<C>) {
    super(`report share rejected: ${code}`);
    this.name = new.target.name;
    this.code = code;
    this.params = args[0] as ReportShareErrorParams<C>;
  }
}

function copyFor<C extends ReportShareErrorCode>(
  code: C,
  params: ReportShareErrorParams<C>,
): string {
  return DEFINITIONS[code].copy(params);
}

/** 将分享链接领域错误映射为 HTTP 响应。 */
export function reportShareErrorResponse(error: ReportShareError): Response {
  const definition = DEFINITIONS[error.code];
  const copy = copyFor(
    error.code,
    error.params as ReportShareErrorParams<typeof error.code>,
  );
  return Response.json({ error: copy }, { status: definition.status });
}
