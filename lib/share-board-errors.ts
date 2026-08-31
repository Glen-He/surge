// 分享面板域错误契约：业务层只抛 code 与强类型 params，HTTP 状态和中文
// 文案由 Route Handler 的 shareBoardErrorResponse() 统一解析。

export type ShareBoardErrorParamsByCode = {
  BOARD_LIMIT_REACHED: { max: number };
  BOARD_REPORT_NOT_FOUND: undefined;
  BOARD_NOT_FOUND: undefined;
  BOARD_ITEM_LIMIT_REACHED: { max: number };
};

export type ShareBoardErrorCode = keyof ShareBoardErrorParamsByCode;
export type ShareBoardErrorParams<C extends ShareBoardErrorCode> =
  ShareBoardErrorParamsByCode[C];
type ShareBoardErrorArgs<C extends ShareBoardErrorCode> =
  ShareBoardErrorParams<C> extends undefined
    ? []
    : [params: ShareBoardErrorParams<C>];

type ShareBoardErrorDefinitionTable = {
  [C in ShareBoardErrorCode]: {
    status: number;
    copy: (params: ShareBoardErrorParams<C>) => string;
  };
};

const DEFINITIONS: ShareBoardErrorDefinitionTable = {
  BOARD_LIMIT_REACHED: {
    status: 400,
    copy: (p) => `最多创建 ${p.max} 个分享面板`,
  },
  BOARD_REPORT_NOT_FOUND: {
    status: 404,
    copy: () => "报告不存在",
  },
  BOARD_NOT_FOUND: {
    status: 404,
    copy: () => "分享面板不存在",
  },
  BOARD_ITEM_LIMIT_REACHED: {
    status: 400,
    copy: (p) => `每个面板最多加入 ${p.max} 份汇报`,
  },
};

function paramsFromArgs<C extends ShareBoardErrorCode>(
  args: ShareBoardErrorArgs<C>,
): ShareBoardErrorParams<C> {
  return args[0] as ShareBoardErrorParams<C>;
}

function copyFor<C extends ShareBoardErrorCode>(
  code: C,
  params: ShareBoardErrorParams<C>,
): string {
  return DEFINITIONS[code].copy(params);
}

/** 分享面板内部异常，不携带 HTTP 语义或中文用户文案。 */
export class ShareBoardError<
  C extends ShareBoardErrorCode = ShareBoardErrorCode,
> extends Error {
  readonly code: C;
  readonly params: ShareBoardErrorParams<C>;

  constructor(code: C, ...args: ShareBoardErrorArgs<C>) {
    super(`share board rejected: ${code}`);
    this.name = new.target.name;
    this.code = code;
    this.params = paramsFromArgs(args);
  }
}

/** Route Handler 的统一 HTTP 状态与中文文案出口。 */
export function shareBoardErrorResponse(error: ShareBoardError): Response {
  const message = copyFor(
    error.code,
    error.params as ShareBoardErrorParams<typeof error.code>,
  );
  return Response.json(
    { error: message },
    { status: DEFINITIONS[error.code].status },
  );
}
