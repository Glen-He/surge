import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      REPORTS_DATA_DIR: "/tmp/surge-vitest-reports",
      BETTER_AUTH_SECRET: "vitest-better-auth-secret-at-least-32-characters",
      API_TOKEN_ENCRYPTION_KEY:
        "vitest-api-token-encryption-key-at-least-32-characters",
      SHARE_SECRET: "vitest-share-secret-at-least-32-characters",
      SHARE_TOKEN_ENCRYPTION_KEY:
        "vitest-share-token-encryption-key-at-least-32-characters",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
});
