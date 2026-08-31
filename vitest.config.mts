import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      REPORTS_DATA_DIR: "/tmp/surge-vitest-reports",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
});
