// 轻量结构化日志（服务端）：单行 JSON 输出，带时间/级别/模块/上下文。
// 不引入外部依赖；生产用 LOG_LEVEL=debug|info|warn|error 控制输出级别。
//
// 用法：
//   logger.error("register", "sign-in/email-otp 失败", e);
//   logger.warn("storage", "全站占用达预警线", { gb: 16.2 });
//   logger.info("seed", "默认用户已创建", { email });

type Ctx = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const raw = process.env.LOG_LEVEL;
  if (raw && raw in ORDER) return ORDER[raw as Level];
  return process.env.NODE_ENV === "production" ? ORDER.info : ORDER.debug;
}

const isErr = (x: unknown): x is Error => x instanceof Error;

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
  if (ctx && typeof ctx === "object") Object.assign(line, ctx);
  if (err) {
    line.error = err.message;
    line.stack = err.stack;
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
