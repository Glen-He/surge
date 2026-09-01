import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const configuredPort = Number(process.env.E2E_PORT ?? 3217);
if (
  !Number.isSafeInteger(configuredPort) ||
  configuredPort < 1 ||
  configuredPort > 65535
) {
  throw new Error("E2E_PORT must be a valid TCP port");
}
const e2ePort = String(configuredPort);
const baseURL = `http://127.0.0.1:${e2ePort}`;
const reportsURL = `http://localhost:${e2ePort}`;
process.env.BETTER_AUTH_URL = baseURL;
// 同一测试进程的两个 loopback host 模拟生产主站域和独立内容域。
process.env.REPORTS_ORIGIN = reportsURL;
process.env.REPORTS_DATA_DIR =
  process.env.E2E_REPORTS_DATA_DIR ?? "/tmp/surge-e2e-reports";
process.env.SHARE_SECRET = "e2e-share-secret-at-least-32-characters";
process.env.SHARE_TOKEN_ENCRYPTION_KEY =
  "e2e-share-token-encryption-key-at-least-32-characters";
process.env.API_TOKEN_ENCRYPTION_KEY =
  "e2e-api-token-encryption-key-at-least-32-characters";
process.env.INVITE_CODE_SECRET =
  "e2e-invite-code-secret-at-least-32-characters";
process.env.MAINTENANCE_SECRET = "e2e-maintenance-secret-at-least-32-characters";
process.env.SMTP_HOST = "localhost";
process.env.SMTP_PORT = "465";
process.env.SMTP_USER = "e2e@example.test";
process.env.SMTP_PASS = "e2e-only-password";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next start --hostname 0.0.0.0 --port ${e2ePort}`,
    url: `${baseURL}/api/health`,
    // 绝不附着到开发者已在运行的应用进程：那可能连接了别的数据库
    // 或 REPORTS_DATA_DIR，让夹具数据看起来不存在。
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
