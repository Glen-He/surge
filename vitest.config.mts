import path from "node:path";
import { defineConfig } from "vitest/config";

/* 测试分层（与 CI 的 unit-test / integration-test 两个 job 一一对应）：
 * - unit：单模块 / 纯逻辑，自带假密钥种子，不需要外部服务；
 * - integration：PostgreSQL / 文件系统 / 多模块协作，由
 *   `pnpm test:integration` 显式开启（SURGE_DB_INTEGRATION=1），
 *   DATABASE_URL 必须由运行环境提供（CI 来自 .github/ci.env）。
 * 两个项目种子同一批 always 必需密钥，保证测试环境满足生产代码的
 * 安全契约（而不是生产代码为测试开后门）。
 * 注：inline projects 不继承根级 resolve，alias 需在每个项目重复声明。
 */
const seededEnv = {
  REPORTS_DATA_DIR: "/tmp/surge-vitest-reports",
  BETTER_AUTH_SECRET: "vitest-better-auth-secret-at-least-32-characters",
  API_TOKEN_ENCRYPTION_KEY:
    "vitest-api-token-encryption-key-at-least-32-characters",
  SHARE_SECRET: "vitest-share-secret-at-least-32-characters",
  SHARE_TOKEN_ENCRYPTION_KEY:
    "vitest-share-token-encryption-key-at-least-32-characters",
  INVITE_CODE_SECRET: "vitest-invite-code-secret-at-least-32-characters",
};

const alias = { "@": path.resolve(process.cwd(), "src") };

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
          env: seededEnv,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          env: seededEnv,
        },
      },
    ],
  },
});
