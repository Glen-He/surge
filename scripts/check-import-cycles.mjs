// 循环依赖检查：使用 TypeScript AST 扫描 src/ 内生产模块的静态导入、
// 再导出与字面量动态 import，构建真实的仓库内依赖图并检出全部环。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts"];
const SOURCE_FILE = /\.(?:ts|tsx|mts)$/;
const TEST_FILE = /(?:^|\/).+\.(?:test|spec)\.(?:ts|tsx|mts)$/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(absolute)) {
      files.push(absolute);
    }
  }
  return files;
}

function moduleSpecifiers(file, content) {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const result = new Set();

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.add(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      result.add(node.arguments[0].text);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      result.add(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return result;
}

function isFile(candidate) {
  return existsSync(candidate) && statSync(candidate).isFile();
}

function resolveSpecifier(specifier, fromFile) {
  if (
    !specifier.startsWith("@/") &&
    !specifier.startsWith("./") &&
    !specifier.startsWith("../")
  ) {
    return null;
  }
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find(isFile) ?? null;
}

const files = walk(SRC).sort();
const graph = new Map();
let edgeCount = 0;

for (const file of files) {
  const dependencies = new Set();
  for (const specifier of moduleSpecifiers(file, readFileSync(file, "utf8"))) {
    const resolved = resolveSpecifier(specifier, file);
    if (resolved && resolved !== file) dependencies.add(resolved);
  }
  edgeCount += dependencies.size;
  graph.set(file, dependencies);
}

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const colors = new Map(files.map((file) => [file, WHITE]));
const stack = [];
const cycleKeys = new Set();
const cycles = [];

function canonicalCycle(cycle) {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => [
    ...body.slice(index),
    ...body.slice(0, index),
  ]);
  rotations.sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
  const canonical = rotations[0];
  return [...canonical, canonical[0]];
}

function visit(file) {
  colors.set(file, GRAY);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) {
    if (!graph.has(dependency)) continue;
    if (colors.get(dependency) === GRAY) {
      const start = stack.lastIndexOf(dependency);
      const cycle = canonicalCycle([...stack.slice(start), dependency]);
      const key = cycle.join("\0");
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        cycles.push(cycle);
      }
    } else if (colors.get(dependency) === WHITE) {
      visit(dependency);
    }
  }
  stack.pop();
  colors.set(file, BLACK);
}

for (const file of files) {
  if (colors.get(file) === WHITE) visit(file);
}

const relative = (file) => path.relative(ROOT, file);
if (cycles.length > 0) {
  console.error("import cycles detected:");
  for (const cycle of cycles) {
    console.error(`  ${cycle.map(relative).join(" -> ")}`);
  }
  process.exit(1);
}

console.log(
  `no import cycles across ${files.length} modules and ${edgeCount} internal edges`,
);
