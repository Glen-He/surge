import {
  environmentSchema,
  type EnvEntry,
  type EnvVarName,
  type EnvironmentSchema,
} from "./schema";

/* serverEnv：业务代码访问环境变量的唯一入口。
 * - 每次访问即时读取并校验（不缓存，兼容 vi.stubEnv 等测试注入）；
 * - 未注册的变量在 TypeScript 层即不可访问（schema 是唯一契约）；
 * - 校验失败直接 throw（fail fast），报错含变量名，与既有启动校验同口径。
 *
 * 本模块保持零 Node 专属依赖（不 import node:*），以便 edge middleware
 * （src/proxy.ts）同样可以引用。
 */

type EnvValue<E extends EnvEntry> =
  E extends { type: "int" } ? number
  : E extends { required: "always" } ? string
  : string | undefined;

export type ServerEnv = {
  [K in keyof EnvironmentSchema]: EnvValue<EnvironmentSchema[K]>;
};

/** 构建阶段：`next build`（含静态生成 worker）。运行时密钥不作为构建依赖。 */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/** 生产服务器运行时（next start；排除 build worker 与 dev/test）。 */
export function isProductionServer(): boolean {
  return process.env.NODE_ENV === "production" && !isBuildPhase();
}

/** Node.js 运行时（instrumentation 在 edge runtime 不执行）。 */
export function isNodejsRuntime(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs";
}

/** 框架控制变量：不属于应用配置，原样透传（不校验、不入 schema 契约）。 */
export const frameworkEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_RUNTIME: process.env.NEXT_RUNTIME,
  NEXT_PHASE: process.env.NEXT_PHASE,
  CI: process.env.CI,
} as const;

function mustValidate(entry: EnvEntry): boolean {
  if (entry.required === "always") return true;
  if (entry.required === "production") return isProductionServer();
  return false;
}

function envValue(name: EnvVarName, entry: EnvEntry): unknown {
  const raw = process.env[name]?.trim() ?? "";
  const must = mustValidate(entry);

  if (entry.type === "int") {
    if (raw === "") {
      if (entry.default !== undefined) return entry.default;
      if (must) throw new Error(`${name} is missing or not a valid integer`);
      return undefined;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
    if (
      (entry.min !== undefined && value < entry.min) ||
      (entry.max !== undefined && value > entry.max)
    ) {
      throw new Error(
        `${name} must be an integer between ${entry.min} and ${entry.max}`,
      );
    }
    return value;
  }

  if (raw === "") {
    if (entry.default !== undefined) return entry.default;
    if (must) throw new Error(`${name} is missing or too short`);
    return undefined;
  }
  if (entry.minLength !== undefined && raw.length < entry.minLength) {
    throw new Error(`${name} is missing or too short`);
  }
  if (entry.enum && !entry.enum.includes(raw)) {
    throw new Error(`${name} must be one of: ${entry.enum.join(", ")}`);
  }
  return raw;
}

const serverEnvObject: Record<string, unknown> = {};
for (const [name, entry] of Object.entries(environmentSchema) as [
  EnvVarName,
  EnvEntry,
][]) {
  Object.defineProperty(serverEnvObject, name, {
    enumerable: true,
    get: () => envValue(name, entry),
  });
}

/** 校验后的服务器环境（每次访问即时校验；类型由 schema 推导） */
export const serverEnv = serverEnvObject as ServerEnv;
