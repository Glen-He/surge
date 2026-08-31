function required(name: string, minLength = 1): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minLength) {
    throw new Error(`${name} is missing or too short`);
  }
  return value;
}

/** 生产专属部署不变量：启动时快速失败（fail fast） */
export function validateProductionEnvironment(): void {
  required("REPORTS_DATA_DIR");
  required("BETTER_AUTH_SECRET", 32);
  required("SHARE_SECRET", 32);
  required("SHARE_TOKEN_ENCRYPTION_KEY", 32);
  for (const name of ["OTP_SECRET", "LOG_REDACTION_SECRET"] as const) {
    const value = process.env[name]?.trim();
    if (value && value.length < 32) {
      throw new Error(`${name} is too short`);
    }
  }
  const registrationMode = process.env.REGISTRATION_MODE?.trim().toLowerCase();
  if (registrationMode && registrationMode !== "open" && registrationMode !== "closed") {
    throw new Error("REGISTRATION_MODE must be open or closed");
  }
  const poolSize = Number(process.env.DB_POOL_MAX ?? 10);
  if (!Number.isSafeInteger(poolSize) || poolSize <= 0) {
    throw new Error("DB_POOL_MAX must be a positive integer");
  }
  for (const [name, fallback] of [
    ["DB_QUERY_TIMEOUT_MS", 15_000],
    ["AUTH_DB_QUERY_TIMEOUT_MS", 15_000],
  ] as const) {
    const timeout = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
      throw new Error(`${name} must be an integer between 1000 and 120000 ms`);
    }
  }
  for (const [name, fallback, min, max] of [
    ["STORAGE_ORPHAN_GRACE_MINUTES", 60, 5, 10_080],
    ["STORAGE_RECOVERY_RETENTION_HOURS", 168, 1, 8_760],
    ["SECURITY_LOG_RETENTION_DAYS", 90, 1, 3_650],
  ] as const) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
  }
  if (process.env.NODE_ENV !== "production") return;

  required("DATABASE_URL");
  required("MAINTENANCE_SECRET", 32);
  required("SMTP_HOST");
  required("SMTP_USER");
  required("SMTP_PASS");
  const smtpPort = Number(required("SMTP_PORT"));
  if (!Number.isSafeInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT must be a valid port");
  }
  const authUrl = new URL(required("BETTER_AUTH_URL"));
  const loopback =
    authUrl.hostname === "localhost" ||
    authUrl.hostname === "127.0.0.1" ||
    authUrl.hostname === "[::1]";
  if (authUrl.protocol !== "https:" && !loopback) {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  }

  const configuredReportsOrigin = process.env.REPORTS_ORIGIN?.trim();
  if (!configuredReportsOrigin && !loopback) {
    throw new Error(
      "REPORTS_ORIGIN must be configured as the dedicated report content origin in production",
    );
  }
  const reportsUrl = new URL(configuredReportsOrigin || authUrl.origin);
  if (reportsUrl.username || reportsUrl.password) {
    throw new Error("REPORTS_ORIGIN must not contain a username or password");
  }
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
