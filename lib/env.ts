function required(name: string, minLength = 1): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minLength) {
    throw new Error(`${name} 未配置或长度不足`);
  }
  return value;
}

/** Fail fast for production-only deployment invariants. */
export function validateProductionEnvironment(): void {
  const poolSize = Number(process.env.DB_POOL_MAX ?? 10);
  if (!Number.isSafeInteger(poolSize) || poolSize <= 0) {
    throw new Error("DB_POOL_MAX 必须是正整数");
  }
  if (process.env.NODE_ENV !== "production") return;

  required("DATABASE_URL");
  required("BETTER_AUTH_SECRET", 32);
  required("SHARE_SECRET", 32);
  required("SMTP_HOST");
  required("SMTP_USER");
  required("SMTP_PASS");
  const smtpPort = Number(required("SMTP_PORT"));
  if (!Number.isSafeInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT 必须是有效端口");
  }
  const authUrl = new URL(required("BETTER_AUTH_URL"));
  const loopback =
    authUrl.hostname === "localhost" ||
    authUrl.hostname === "127.0.0.1" ||
    authUrl.hostname === "[::1]";
  if (authUrl.protocol !== "https:" && !loopback) {
    throw new Error("生产环境 BETTER_AUTH_URL 必须使用 HTTPS");
  }

  const configuredReportsOrigin = process.env.REPORTS_ORIGIN?.trim();
  if (!configuredReportsOrigin && !loopback) {
    throw new Error("生产环境 REPORTS_ORIGIN 必须配置为独立汇报内容域");
  }
  const reportsUrl = new URL(configuredReportsOrigin || authUrl.origin);
  if (reportsUrl.username || reportsUrl.password) {
    throw new Error("REPORTS_ORIGIN 不能包含用户名或密码");
  }
  if (reportsUrl.protocol !== "https:" && !loopback) {
    throw new Error("生产环境 REPORTS_ORIGIN 必须使用 HTTPS");
  }
  if (reportsUrl.pathname !== "/" || reportsUrl.search || reportsUrl.hash) {
    throw new Error("REPORTS_ORIGIN 只能包含协议、主机名和端口");
  }
  if (!loopback && reportsUrl.hostname === authUrl.hostname) {
    throw new Error("REPORTS_ORIGIN 必须使用不同于主站的独立主机名");
  }
}
