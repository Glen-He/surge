export type RegistrationErrorCode =
  | "REGISTRATION_CLOSED"
  | "INVITE_REQUIRED"
  | "INVITE_INVALID"
  | "INVITE_FORMAT"
  | "INVITE_CREATE_FAILED"
  | "INVITE_MUTATION_RATE_LIMIT"
  | "INVITE_ALREADY_EXISTS";

const COPY: Record<RegistrationErrorCode, string> = {
  REGISTRATION_CLOSED: "当前未开放新账号注册",
  INVITE_REQUIRED: "请输入邀请码",
  INVITE_INVALID: "邀请码无效或已撤销",
  INVITE_FORMAT: "请输入 6 位邀请码",
  INVITE_CREATE_FAILED: "邀请码生成失败，请稍后重试",
  INVITE_MUTATION_RATE_LIMIT: "邀请码操作过于频繁，请稍后再试",
  INVITE_ALREADY_EXISTS: "已有邀请码，可直接更换或撤销",
};

/** 注册与邀请码领域文案唯一出口。 */
export function registrationErrorCopy(code: RegistrationErrorCode): string {
  return COPY[code];
}
