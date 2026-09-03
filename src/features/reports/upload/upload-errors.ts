// 上传域错误契约：业务层只流转 code 与 params，HTTP 状态和中文文案只在
// Route Handler 调用 uploadFailureResponse() 时生成。

export type UploadErrorParamsByCode = {
  META_TITLE_DATE_REQUIRED: undefined;
  META_DATE_FORMAT: undefined;
  META_DATE_INVALID: undefined;
  META_TAG_TOO_LONG: { max: number };
  META_TITLE_TOO_LONG: { max: number };
  META_KEYWORDS_TOO_LONG: { max: number };
  META_DESCRIPTION_TOO_LONG: { max: number };
  FILE_TOO_LARGE: { max: number };
  UPLOAD_INVALID: undefined;
  ZIP_EMPTY_PATH: undefined;
  ZIP_PATH_INVALID: { path: string };
  ZIP_DEPTH_EXCEEDED: { max: number; path: string };
  ZIP_SYMLINK: { path: string };
  ZIP_SPECIAL_FILE: { mode: string; path: string };
  ZIP_DUPLICATE_PATH: { path: string };
  ZIP_FILE_COUNT: { max: number };
  ZIP_SIZE_INVALID: { path: string };
  ZIP_TOTAL_SIZE: { max: string };
  ZIP_ENTRY_TYPE: { path: string };
  ZIP_PATH_ESCAPE: { path: string };
  FORM_NOT_MULTIPART: undefined;
  FORM_LENGTH_REQUIRED: undefined;
  FORM_MULTIPART_TOO_LARGE: { max: number };
  FORM_INVALID: undefined;
  FORM_FIELD_TOO_LONG: undefined;
  FORM_SINGLE_FILE_FIELD: undefined;
  FORM_FILE_TOO_LARGE: { max: number };
  FORM_FILES_LIMIT: undefined;
  FORM_FIELDS_LIMIT: undefined;
  FORM_PARTS_LIMIT: undefined;
  FORM_STAGING_FAILED: undefined;
  UPLOAD_UNAVAILABLE: undefined;
  UPLOAD_BUSY: undefined;
  STORAGE_CAPACITY: undefined;
  SITE_CAP_REACHED: undefined;
  GUEST_UPLOAD_LIMIT: undefined;
  USER_QUOTA_EXCEEDED: { max: number; used: number };
  USER_QUOTA_REPLACE_EXCEEDED: { max: number };
  REPORT_NOT_FOUND: undefined;
  SAVE_FAILED: undefined;
  REPLACE_FAILED: undefined;
  DELETE_FAILED: undefined;
};

export type UploadErrorCode = keyof UploadErrorParamsByCode;
export type UploadErrorParams<C extends UploadErrorCode> =
  UploadErrorParamsByCode[C];
export type UploadErrorArgs<C extends UploadErrorCode> =
  UploadErrorParams<C> extends undefined
    ? []
    : [params: UploadErrorParams<C>];

type UploadCopyTable = {
  [C in UploadErrorCode]: (params: UploadErrorParams<C>) => string;
};

const COPY: UploadCopyTable = {
  META_TITLE_DATE_REQUIRED: () => "标题和日期必填",
  META_DATE_FORMAT: () => "日期格式必须为 YYYY-MM-DD",
  META_DATE_INVALID: () => "请填写有效日期",
  META_TAG_TOO_LONG: (p) => `标签最长 ${p.max} 字`,
  META_TITLE_TOO_LONG: (p) => `名称最长 ${p.max} 字`,
  META_KEYWORDS_TOO_LONG: (p) => `关键词最长 ${p.max} 字`,
  META_DESCRIPTION_TOO_LONG: (p) => `简介最长 ${p.max} 字`,
  FILE_TOO_LARGE: (p) => `文件超过 ${p.max}MB 上限`,
  UPLOAD_INVALID: () => "文件无效或缺少 report.html（入口文件）",
  ZIP_EMPTY_PATH: () => "压缩包包含空路径或 NUL 字符",
  ZIP_PATH_INVALID: (p) => `检测到非法路径：${p.path}`,
  ZIP_DEPTH_EXCEEDED: (p) => `目录深度超过 ${p.max} 层上限：${p.path}`,
  ZIP_SYMLINK: (p) => `检测到符号链接，已拒绝：${p.path}`,
  ZIP_SPECIAL_FILE: (p) =>
    `不允许的特殊文件类型（0o${p.mode}），已拒绝：${p.path}`,
  ZIP_DUPLICATE_PATH: (p) => `压缩包包含重复文件路径：${p.path}`,
  ZIP_FILE_COUNT: (p) => `文件数量超过 ${p.max} 个上限`,
  ZIP_SIZE_INVALID: (p) => `文件大小声明非法：${p.path}`,
  ZIP_TOTAL_SIZE: (p) => `解压后总大小超过 ${p.max} 上限`,
  ZIP_ENTRY_TYPE: (p) => `不允许的文件类型：${p.path}`,
  ZIP_PATH_ESCAPE: (p) => `检测到路径逃逸：${p.path}`,
  FORM_NOT_MULTIPART: () => "请求体必须是 multipart 表单",
  FORM_LENGTH_REQUIRED: () => "上传请求必须包含有效的 Content-Length",
  FORM_MULTIPART_TOO_LARGE: (p) => `上传请求超过 ${p.max}MB 上限`,
  FORM_INVALID: () => "multipart 表单无效",
  FORM_FIELD_TOO_LONG: () => "表单字段过长",
  FORM_SINGLE_FILE_FIELD: () => "只允许一个 file 字段",
  FORM_FILE_TOO_LARGE: (p) => `文件超过 ${p.max}MB 上限`,
  FORM_FILES_LIMIT: () => "只允许上传一个文件",
  FORM_FIELDS_LIMIT: () => "表单字段过多",
  FORM_PARTS_LIMIT: () => "表单内容过多",
  FORM_STAGING_FAILED: () => "无法创建上传暂存目录，请稍后重试",
  UPLOAD_UNAVAILABLE: () => "上传服务暂时不可用，请稍后重试",
  UPLOAD_BUSY: () => "当前上传任务较多，请稍后重试",
  STORAGE_CAPACITY: () => "服务器可用存储空间不足，上传暂停，请联系管理员",
  SITE_CAP_REACHED: () => "服务器存储已达上限，上传暂停，请联系管理员",
  GUEST_UPLOAD_LIMIT: () => "游客模式最多上传 1 个项目，删除后可再次上传",
  USER_QUOTA_EXCEEDED: (p) =>
    `个人存储上限 ${p.max}MB（已用 ${p.used}MB），请先删除一些报告再上传`,
  USER_QUOTA_REPLACE_EXCEEDED: (p) =>
    `个人存储上限 ${p.max}MB，请先删除一些报告再上传`,
  REPORT_NOT_FOUND: () => "项目不存在",
  SAVE_FAILED: () => "保存失败，请重试",
  REPLACE_FAILED: () => "替换报告文件失败，请重试",
  DELETE_FAILED: () => "删除失败，请重试",
};

const STATUS: { [C in UploadErrorCode]: number } = {
  META_TITLE_DATE_REQUIRED: 400,
  META_DATE_FORMAT: 400,
  META_DATE_INVALID: 400,
  META_TAG_TOO_LONG: 400,
  META_TITLE_TOO_LONG: 400,
  META_KEYWORDS_TOO_LONG: 400,
  META_DESCRIPTION_TOO_LONG: 400,
  FILE_TOO_LARGE: 400,
  UPLOAD_INVALID: 400,
  ZIP_EMPTY_PATH: 400,
  ZIP_PATH_INVALID: 400,
  ZIP_DEPTH_EXCEEDED: 400,
  ZIP_SYMLINK: 400,
  ZIP_SPECIAL_FILE: 400,
  ZIP_DUPLICATE_PATH: 400,
  ZIP_FILE_COUNT: 400,
  ZIP_SIZE_INVALID: 400,
  ZIP_TOTAL_SIZE: 400,
  ZIP_ENTRY_TYPE: 400,
  ZIP_PATH_ESCAPE: 400,
  FORM_NOT_MULTIPART: 415,
  FORM_LENGTH_REQUIRED: 411,
  FORM_MULTIPART_TOO_LARGE: 413,
  FORM_INVALID: 400,
  FORM_FIELD_TOO_LONG: 400,
  FORM_SINGLE_FILE_FIELD: 400,
  FORM_FILE_TOO_LARGE: 413,
  FORM_FILES_LIMIT: 400,
  FORM_FIELDS_LIMIT: 400,
  FORM_PARTS_LIMIT: 400,
  FORM_STAGING_FAILED: 503,
  UPLOAD_UNAVAILABLE: 503,
  UPLOAD_BUSY: 503,
  STORAGE_CAPACITY: 507,
  SITE_CAP_REACHED: 503,
  GUEST_UPLOAD_LIMIT: 403,
  USER_QUOTA_EXCEEDED: 403,
  USER_QUOTA_REPLACE_EXCEEDED: 403,
  REPORT_NOT_FOUND: 404,
  SAVE_FAILED: 500,
  REPLACE_FAILED: 500,
  DELETE_FAILED: 500,
};

type UploadFailureFor<C extends UploadErrorCode> = {
  ok: false;
  code: C;
  params: UploadErrorParams<C>;
};

export type UploadFailure = {
  [C in UploadErrorCode]: UploadFailureFor<C>;
}[UploadErrorCode];

function paramsFromArgs<C extends UploadErrorCode>(
  args: UploadErrorArgs<C>,
): UploadErrorParams<C> {
  return args[0] as UploadErrorParams<C>;
}

function copyFor<C extends UploadErrorCode>(
  code: C,
  params: UploadErrorParams<C>,
): string {
  return COPY[code](params);
}

/** 构造强类型失败结果；需要参数的错误码无法漏传或错传参数。 */
export function uploadFailure<C extends UploadErrorCode>(
  code: C,
  ...args: UploadErrorArgs<C>
): UploadFailureFor<C> {
  return { ok: false, code, params: paramsFromArgs(args) };
}

/** Route Handler 的唯一中文翻译出口。 */
export function uploadFailureResponse(failure: UploadFailure): Response {
  const message = copyFor(
    failure.code,
    failure.params as UploadErrorParams<typeof failure.code>,
  );
  return Response.json({ error: message }, { status: STATUS[failure.code] });
}

/**
 * 上传域内部异常：message 只含稳定英文 code；用户输入保留在 params 字段，
 * 不会因记录 error.message 而进入日志。
 */
export class UploadError<C extends UploadErrorCode = UploadErrorCode> extends Error {
  readonly code: C;
  readonly params: UploadErrorParams<C>;

  constructor(code: C, ...args: UploadErrorArgs<C>) {
    super(`upload rejected: ${code}`);
    this.name = new.target.name;
    this.code = code;
    this.params = paramsFromArgs(args);
  }

  toFailure(): UploadFailureFor<C> {
    return { ok: false, code: this.code, params: this.params };
  }
}
