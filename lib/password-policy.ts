// 密码策略：至少 8 位，且必须同时包含大写字母、小写字母和数字。
// 客户端（表单预检）与服务端（API 入口）共用同一实现，保证口径一致。

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 100;

/** 统一提示文案（输入框 placeholder / 说明文字用） */
export const PASSWORD_RULE_TEXT = `至少 ${PASSWORD_MIN} 位，含大写字母、小写字母和数字`;

/** 返回错误文案；合法返回 null */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `密码至少 ${PASSWORD_MIN} 位`;
  }
  if (password.length > PASSWORD_MAX) {
    return "密码过长";
  }
  if (!/[a-z]/.test(password)) {
    return "密码需包含小写字母";
  }
  if (!/[A-Z]/.test(password)) {
    return "密码需包含大写字母";
  }
  if (!/[0-9]/.test(password)) {
    return "密码需包含数字";
  }
  return null;
}
