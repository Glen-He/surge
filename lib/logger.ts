import { createHmac, hkdfSync } from "node:crypto";

// 轻量结构化日志（服务端）：单行 JSON 输出，带时间/级别/模块/上下文。
// 不引入外部依赖；生产用 LOG_LEVEL=debug|info|warn|error 控制输出级别。
//
// 规范：message 一律英文（面向开发排查），业务参数全部放 ctx 对象；
// 用户可见文案禁止写入 message（用户文案见 lib/auth-errors.ts、
// lib/upload-errors.ts、lib/password-policy.ts 等文案模块）。
//
// 用法：
//   logger.error("register", "sign-in/email-otp failed", e);
//   logger.warn("storage", "site usage reached warning threshold", { usedGB: 16.2 });
//   logger.info("seed", "default user created", { email });

type Ctx = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const raw = process.env.LOG_LEVEL;
  if (raw && raw in ORDER) return ORDER[raw as Level];
  return process.env.NODE_ENV === "production" ? ORDER.info : ORDER.debug;
}

const isErr = (x: unknown): x is Error => x instanceof Error;

function fingerprint(value: string): string {
  const root = process.env.LOG_REDACTION_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!root || root.length < 32) {
    throw new Error("LOG_REDACTION_SECRET or BETTER_AUTH_SECRET is required");
  }
  const key = Buffer.from(
    hkdfSync("sha256", root, "surge-log-redaction", "v1", 32),
  );
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 12);
}

function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\bsgk_[A-Za-z0-9_-]+\b/g, "sgk_[redacted]")
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      (email) => `fp:${fingerprint(email.toLowerCase())}`,
    )
    .replace(
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      (address) => `fp:${fingerprint(address)}`,
    )
    .replace(/\/(?:s|b|r)\/[^\s/?#]+/g, (match) => `${match.slice(0, 3)}[redacted]`);
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const lower = key.toLowerCase();
  if (/password|secret|authorization|cookie|token|otp|capability/.test(lower)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (/email|ip|useragent|user_agent/.test(lower)) return `fp:${fingerprint(value)}`;
    // Bearer 凭证与常见个人标识绝不能进入运行日志，
    // 即使它们嵌在通用错误 message 里也要先脱敏。
    return sanitizeText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(key, item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        sanitizeValue(childKey, child),
      ]),
    );
  }
  return value;
}

function emit(level: Level, scope: string, msg: string, a?: unknown, b?: unknown) {
  if (ORDER[level] < minLevel()) return;
  const err = isErr(a) ? a : isErr(b) ? b : undefined;
  const ctx = (a === undefined || isErr(a) ? b : a) as Ctx | undefined;

  const line: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
  };
  if (ctx && typeof ctx === "object") Object.assign(line, sanitizeValue("context", ctx));
  if (err) {
    line.error = sanitizeText(err.message);
    if (process.env.NODE_ENV !== "production" || minLevel() <= ORDER.debug) {
      line.stack = err.stack ? sanitizeText(err.stack) : undefined;
    }
  }

  const text = JSON.stringify(line, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  debug(scope: string, msg: string, ctx?: Ctx) {
    emit("debug", scope, msg, ctx);
  },
  info(scope: string, msg: string, ctx?: Ctx) {
    emit("info", scope, msg, ctx);
  },
  warn(scope: string, msg: string, errOrCtx?: Error | Ctx, ctx?: Ctx) {
    emit("warn", scope, msg, errOrCtx, ctx);
  },
  error(scope: string, msg: string, errOrCtx?: Error | Ctx, ctx?: Ctx) {
    emit("error", scope, msg, errOrCtx, ctx);
  },
};
