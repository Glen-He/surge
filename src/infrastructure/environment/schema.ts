/* 环境变量唯一契约（Single Source of Truth）：
 * - 业务代码不得直接读 process.env，一律经 server.ts 的 serverEnv 访问（ESLint 强制）；
 * - 新增变量必须先在本 schema 注册，随后 .env.example / .github/ci.env 会由
 *   env-contract.test.ts 自动校验同步，漏配会在 CI 第一个 job（environment）1 秒内失败；
 * - required 语义（与既有启动校验保持一致）：
 *   - "always"     任何上下文访问即校验（开发 / 测试 / 构建 / 生产）
 *   - "production" 仅生产服务器运行时强制（NODE_ENV=production 且非构建阶段）；
 *                  其他上下文返回 undefined / 默认值
 *   - "optional"   允许缺失（可带默认值）；一旦提供仍校验格式与长度
 */

export type EnvKind =
  | "secret" // 服务器密钥：绝不暴露给浏览器
  | "config" // 服务器配置：不敏感但仅限服务器
  | "public" // 构建期注入浏览器的 NEXT_PUBLIC_* 变量
  | "storage" // 存储 / 容量 / 保留策略
  | "framework" // Next.js / 运行时框架控制变量（不由用户配置）
  | "test"; // 测试执行控制（不属于应用配置，不进 .env.example）

export type EnvRequired = "always" | "production" | "optional";

export type EnvEntry = {
  kind: EnvKind;
  required: EnvRequired;
  /** 字符串最小长度（通常 secret 为 32） */
  minLength?: number;
  /** 整数类型：返回 number 而非 string */
  type?: "int";
  /** int 默认值 / optional 字符串默认值 */
  default?: number | string;
  /** int 合法范围（闭区间） */
  min?: number;
  max?: number;
  /** 字符串枚举白名单 */
  enum?: readonly string[];
  /** 该变量由测试 harness（playwright.config）注入，不进 ci.env 契约 */
  providedByHarness?: boolean;
  /** 用途说明：契约测试据此与 .env.example 对齐 */
  note: string;
};

export const environmentSchema = {
  /* ── 数据库 ── */
  DATABASE_URL: {
    kind: "config",
    required: "production",
    note: "PostgreSQL 连接串",
  },
  DB_POOL_MAX: {
    kind: "config",
    required: "optional",
    type: "int",
    default: 10,
    min: 1,
    note: "业务/认证两个连接池的各自最大连接数",
  },
  DB_QUERY_TIMEOUT_MS: {
    kind: "config",
    required: "optional",
    type: "int",
    default: 15_000,
    min: 1_000,
    max: 120_000,
    note: "业务查询硬超时（毫秒）",
  },
  AUTH_DB_QUERY_TIMEOUT_MS: {
    kind: "config",
    required: "optional",
    type: "int",
    default: 15_000,
    min: 1_000,
    max: 120_000,
    note: "认证查询硬超时（毫秒）",
  },

  /* ── 认证 ── */
  BETTER_AUTH_SECRET: {
    kind: "secret",
    required: "always",
    minLength: 32,
    note: "better-auth 认证密钥与 report capability 签名根密钥",
  },
  BETTER_AUTH_URL: {
    kind: "config",
    required: "production",
    note: "应用对外 origin（生产必须 HTTPS 或 loopback）",
  },
  OTP_SECRET: {
    kind: "secret",
    required: "optional",
    minLength: 32,
    note: "自管 OTP 的 HMAC 专用密钥；留空从 BETTER_AUTH_SECRET 派生",
  },
  TRUSTED_PROXIES: {
    kind: "config",
    required: "optional",
    default: "127.0.0.1,::1",
    note: "认证限流信任的反代地址（IP/CIDR，逗号分隔）",
  },

  /* ── 注册邀请 ── */
  INVITE_CODE_SECRET: {
    kind: "secret",
    required: "always",
    minLength: 32,
    note: "邀请码 HMAC lookup 与 AES-GCM 加密的独立派生根密钥",
  },

  /* ── 分享 ── */
  SHARE_SECRET: {
    kind: "secret",
    required: "always",
    minLength: 32,
    note: "分享密码门解锁凭证（unlock proof / cookie）签名密钥",
  },
  SHARE_TOKEN_ENCRYPTION_KEY: {
    kind: "secret",
    required: "always",
    minLength: 32,
    note: "分享 URL 令牌与 4 位提取码的 AES-GCM 加密根密钥",
  },

  /* ── API 令牌 ── */
  API_TOKEN_ENCRYPTION_KEY: {
    kind: "secret",
    required: "always",
    minLength: 32,
    note: "PAT 令牌 AES-GCM 独立加密根密钥（供所有者再次查看明文）",
  },

  /* ── 内部维护 ── */
  MAINTENANCE_SECRET: {
    kind: "secret",
    required: "production",
    minLength: 32,
    note: "外部 cron 触发 /api/internal/maintenance 的 Bearer 密钥",
  },

  /* ── 报告存储与内容域 ── */
  REPORTS_DATA_DIR: {
    kind: "config",
    required: "always",
    note: "用户报告持久化数据目录（必须在 checkout 之外）",
  },
  REPORTS_ORIGIN: {
    kind: "config",
    required: "optional",
    providedByHarness: true,
    note: "独立无 Cookie 汇报内容域；本地留空回退主站 origin",
  },
  NEXT_PUBLIC_APP_URL: {
    kind: "public",
    required: "optional",
    note: "构建期注入的应用 origin 兜底（BETTER_AUTH_URL 的次级回退）",
  },

  /* ── 存储 / 容量 / 保留策略 ── */
  UPLOAD_MAX_CONCURRENCY: {
    kind: "storage",
    required: "optional",
    type: "int",
    default: 2,
    min: 1,
    note: "跨实例同时解析上传的最大并发",
  },
  STORAGE_MIN_FREE_BYTES: {
    kind: "storage",
    required: "optional",
    type: "int",
    default: 536_870_912,
    min: 1,
    note: "除本次写入外磁盘至少保留的余量（字节）",
  },
  STORAGE_ORPHAN_GRACE_MINUTES: {
    kind: "storage",
    required: "optional",
    type: "int",
    default: 60,
    min: 5,
    max: 10_080,
    note: "崩溃遗留文件多少分钟后回收",
  },
  STORAGE_RECOVERY_RETENTION_HOURS: {
    kind: "storage",
    required: "optional",
    type: "int",
    default: 168,
    min: 1,
    max: 8_760,
    note: "无法判断归属的回收区数据最长保留小时数",
  },
  SECURITY_LOG_RETENTION_DAYS: {
    kind: "storage",
    required: "optional",
    type: "int",
    default: 90,
    min: 1,
    max: 3_650,
    note: "安全审计日志保留天数",
  },

  /* ── SMTP ── */
  SMTP_HOST: {
    kind: "config",
    required: "production",
    note: "SMTP 服务器地址",
  },
  SMTP_PORT: {
    kind: "config",
    required: "optional",
    type: "int",
    default: 465,
    min: 1,
    max: 65_535,
    note: "SMTP 端口",
  },
  SMTP_USER: {
    kind: "config",
    required: "production",
    note: "SMTP 登录账号（同时用作发件人）",
  },
  SMTP_PASS: {
    kind: "secret",
    required: "production",
    note: "SMTP 登录密码",
  },

  /* ── 日志 ── */
  LOG_LEVEL: {
    kind: "config",
    required: "optional",
    enum: ["debug", "info", "warn", "error"],
    note: "结构化日志输出级别（默认生产 info、开发 debug）",
  },
  LOG_REDACTION_SECRET: {
    kind: "secret",
    required: "optional",
    minLength: 32,
    note: "日志邮箱/IP 指纹盐；留空从 BETTER_AUTH_SECRET 派生",
  },

  /* ── 测试执行控制（不进 .env.example / 生产）── */
  SURGE_DB_INTEGRATION: {
    kind: "test",
    required: "optional",
    enum: ["0", "1"],
    note: "为 1 时运行 PostgreSQL 集成测试",
  },
  E2E_PORT: {
    kind: "test",
    required: "optional",
    type: "int",
    default: 3217,
    min: 1,
    max: 65_535,
    note: "E2E 本地服务器端口",
  },
  E2E_REPORTS_DATA_DIR: {
    kind: "test",
    required: "optional",
    note: "E2E 隔离报告数据目录",
  },
  PERF_RUN: {
    kind: "test",
    required: "optional",
    enum: ["0", "1"],
    note: "性能基线 E2E 开关",
  },
} as const satisfies Record<string, EnvEntry>;

export type EnvironmentSchema = typeof environmentSchema;
export type EnvVarName = keyof EnvironmentSchema;

/** 应出现在 .env.example 的键（应用配置；排除 framework / test） */
export const documentedEnvKeys = (Object.keys(environmentSchema) as EnvVarName[]).filter(
  (name) => {
    const kind = environmentSchema[name].kind;
    return kind === "secret" || kind === "config" || kind === "public" || kind === "storage";
  },
);

/** CI 假环境（.github/ci.env）必须覆盖的键：非 optional、且非 harness 注入 */
export const ciRequiredEnvKeys = (Object.keys(environmentSchema) as EnvVarName[]).filter(
  (name) => {
    const entry = environmentSchema[name] as EnvEntry;
    return entry.required !== "optional" && !entry.providedByHarness;
  },
);
