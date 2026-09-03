// 循环依赖检查：扫描 src/ 全部 TS 模块的 import 说明符（静态 + 动态），
// 构建依赖图并检出环。环意味着 ownership 或抽象放错位置，CI 直接失败。
// 用法：node scripts/check-import-cycles.mjs
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");
const EXT = /\.(ts|tsx|mts)$/;

function walk(dir, files = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (EXT.test(e.name) && e.name.endsWith(".test.ts") === false) files.push(p);
  }
  return files;
}

// 提取 import 说明符：from "x"（含 type import）与动态 import("x")
function importSpecifiers(content) {
  const specs = new Set();
  for (const m of content.matchAll(/import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g)) {
    specs.add(m[1]);
  }
  for (const m of content.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    specs.add(m[1]);
  }
  for (const m of content.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.add(m[1]);
  }
  return [...specs];
}

// 说明符 → 仓库内文件路径（外部包与 CSS 返回 null）
function resolveSpecifier(spec, fromFile) {
  if (!spec.startsWith("@/") && !spec.startsWith("./") && !spec.startsWith("../")) {
    return null; // 外部包（react、better-auth 等）
  }
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec);
  for (const ext of ["", ".ts", ".tsx", ".mts", "/index.ts"]) {
    const candidate = base + ext;
    try {
      const stat = readdirSync(candidate) !== undefined ? candidate : null;
      if (stat) return stat;
    } catch {
      // 不是目录/文件，继续尝试扩展名
    }
  }
  return null;
}

const files = walk(SRC);
const graph = new Map(); // file -> Set<file>
const byModule = (f) => path.relative(ROOT, f);

for (const f of files) {
  const content = readFileSync(f, "utf8");
  const deps = new Set();
  for (const spec of importSpecifiers(content)) {
    const resolved = resolveSpecifier(spec, f);
    if (resolved && resolved !== f) deps.add(resolved);
  }
  graph.set(f, deps);
}

// DFS 检环（迭代式，报告所有环）
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map([...graph.keys()].map((f) => [f, WHITE]));
const stack = [];
const cycles = [];

function dfs(node) {
  color.set(node, GRAY);
  stack.push(node);
  for (const dep of graph.get(node) ?? []) {
    if (color.get(dep) === GRAY) {
      const idx = stack.indexOf(dep);
      cycles.push([...stack.slice(idx), node].map(byModule));
    } else if (color.get(dep) === WHITE) {
      dfs(dep);
    }
  }
  stack.pop();
  color.set(node, BLACK);
}

for (const f of graph.keys()) {
  if (color.get(f) === WHITE) dfs(f);
}

if (cycles.length > 0) {
  console.error("import cycles detected:");
  for (const c of new Set(cycles.map((c) => c.join(" -> ")))) {
    console.error(`  ${c}`);
  }
  process.exit(1);
}
console.log(`no import cycles across ${files.length} modules`);
