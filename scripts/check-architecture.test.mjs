// 用独立源码夹具验证检查器本身，避免白名单和外部模块检查静默失效。
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const checker = fileURLToPath(new URL("./check-architecture.mjs", import.meta.url));
function check(files) {
  const root = mkdtempSync(path.join(tmpdir(), "surge-architecture-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, "src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
for (const specifier of ["fs", "node:fs/promises", "child_process", "pg", "nodemailer", "@/infrastructure/database/client", "../../../infrastructure/database/client.ts"]) {
  test(`普通路由拒绝底层访问：${specifier}`, () => {
    const result = check({ "app/api/example/route.ts": `import source from ${JSON.stringify(specifier)};` });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Route Handler must call a feature use case/);
  });
}
test("仅登记的平台文件流端点可直接读取文件", () => {
  assert.equal(check({ "app/platform/[file]/route.ts": 'import fs from "node:fs";' }).status, 0);
});
test("生产 Feature 环必须失败，测试可以跨层验证组合行为", () => {
  assert.equal(check({ "features/a/a.ts": 'export * from "@/features/b/b";', "features/b/b.ts": 'import type { A } from "@/features/a/a";' }).status, 1);
  assert.equal(check({ "infrastructure/db.test.ts": 'import { x } from "@/features/a/a";', "features/a/a.ts": 'export const x = 1;' }).status, 0);
});
