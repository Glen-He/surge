import { environmentSchema, type EnvEntry, type EnvVarName } from "./schema";
import { isProductionServer } from "./server";

/* 运行时环境全量校验（fail fast）：
 * - 服务器启动时由 instrumentation 调用（见 src/instrumentation.ts）；
 * - 构建阶段不调用：运行时密钥（SMTP / MAINTENANCE / INVITE 等）不作为构建依赖；
 * - 简单项（存在性 / 长度 / 整数范围 / 枚举）由 schema 驱动，
 *   origin 复合规则（HTTPS / 内容域隔离）保持手写以承载完整语义。
 */

function readEnv(name: EnvVarName): string {
  return process.env[name]?.trim() ?? "";
}

function validateEntry(name: EnvVarName, entry: EnvEntry, enforce: boolean) {
  const value = readEnv(name);
  const present = value !== "";

  if (entry.type === "int") {
    if (!present) {
      if (enforce && entry.default === undefined) {
        throw new Error(`${name} is missing`);
      }
      return;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`${name} must be an integer`);
    }
    const { min, max } = entry;
    if (
      (min !== undefined && parsed < min) ||
      (max !== undefined && parsed > max)
    ) {
      const bound =
        min !== undefined && max !== undefined
          ? ` between ${min} and ${max}`
          : min !== undefined
            ? ` of at least ${min}`
            : ` of at most ${max}`;
      throw new Error(`${name} must be an integer${bound}`);
    }
    return;
  }

  if (!present) {
    if (enforce) throw new Error(`${name} is missing or too short`);
    return;
  }
  // 提供即校验（optional secret 配短值同样拒绝，与既有行为一致）
  if (entry.minLength !== undefined && value.length < entry.minLength) {
    throw new Error(`${name} is too short`);
  }
  if (entry.enum && !entry.enum.includes(value)) {
    throw new Error(`${name} must be one of: ${entry.enum.join(", ")}`);
  }
}

function httpOrigin(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} only supports http/https`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain a username or password`);
  }
  return url;
}

const isLoopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]";

/** 服务器启动时的环境契约校验：任何违规直接抛错拒绝启动。 */
export function validateRuntimeEnvironment(): void {
  for (const [name, entry] of Object.entries(environmentSchema) as [
    EnvVarName,
    EnvEntry,
  ][]) {
    if (entry.kind === "framework" || entry.kind === "test") continue;
    const enforce =
      entry.required === "always" ||
      (entry.required === "production" && isProductionServer());
    // optional + harness 注入（REPORTS_ORIGIN）交给下方复合规则裁决
    if (entry.required === "optional" && entry.providedByHarness) continue;
    validateEntry(name, entry, enforce);
  }

  if (!isProductionServer()) return;

  /* ── 生产专属复合规则（与既有校验语义一致）── */
  const authUrl = httpOrigin(readEnv("BETTER_AUTH_URL"), "BETTER_AUTH_URL");
  const loopback = isLoopback(authUrl.hostname);
  if (authUrl.protocol !== "https:" && !loopback) {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  }

  const configuredReportsOrigin = readEnv("REPORTS_ORIGIN");
  if (!configuredReportsOrigin && !loopback) {
    throw new Error(
      "REPORTS_ORIGIN must be configured as the dedicated report content origin in production",
    );
  }
  if (configuredReportsOrigin) {
    const reportsUrl = httpOrigin(
      configuredReportsOrigin,
      "REPORTS_ORIGIN",
    );
    if (reportsUrl.protocol !== "https:" && !loopback) {
      throw new Error("REPORTS_ORIGIN must use HTTPS in production");
    }
    if (reportsUrl.pathname !== "/" || reportsUrl.search || reportsUrl.hash) {
      throw new Error("REPORTS_ORIGIN may only contain scheme, host and port");
    }
    if (!loopback && reportsUrl.hostname === authUrl.hostname) {
      throw new Error("REPORTS_ORIGIN must use a hostname distinct from the main site");
    }
  }
}
