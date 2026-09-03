// 架构边界检查：补足 ESLint 无法覆盖的相对导入、Feature 级依赖环与
// Route Handler 直接访问底层数据库等问题。违反规则时 CI 直接失败。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");
const SOURCE_FILE = /\.(?:ts|tsx|mts)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|mts)$/;
const ROUTE_INFRASTRUCTURE_ALLOWLIST = new Set([
  "src/app/api/health/route.ts",
  "src/app/r/[cap]/[...path]/route.ts",
]);
const FORBIDDEN_SOURCE_DIRECTORIES = ["lib", "components", "actions"];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) files.push(absolute);
  }
  return files;
}

function imports(file) {
  const content = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const result = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      result.push(node.arguments[0].text);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      result.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function absoluteModule(specifier, fromFile) {
  if (specifier.startsWith("@/")) {
    return path.join(SRC, specifier.slice(2));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  return null;
}

function layer(file) {
  const relative = path.relative(SRC, file).replaceAll(path.sep, "/");
  return relative.split("/")[0];
}

function feature(file) {
  const relative = path.relative(path.join(SRC, "features"), file);
  if (relative.startsWith("..")) return null;
  return relative.split(path.sep)[0];
}

const files = walk(SRC).sort();
const violations = [];
const featureGraph = new Map();

for (const directory of FORBIDDEN_SOURCE_DIRECTORIES) {
  if (existsSync(path.join(SRC, directory))) {
    violations.push(`src/${directory}: forbidden generic source directory`);
  }
}

function checkSourceArtifacts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.name === ".DS_Store") {
      violations.push(
        `${path.relative(ROOT, absolute).replaceAll(path.sep, "/")}: forbidden generated artifact`,
      );
    } else if (entry.isDirectory()) {
      checkSourceArtifacts(absolute);
    }
  }
}

checkSourceArtifacts(SRC);

for (const file of files) {
  const sourceLayer = layer(file);
  const sourceFeature = feature(file);
  if (sourceFeature && !featureGraph.has(sourceFeature)) {
    featureGraph.set(sourceFeature, new Set());
  }
  for (const specifier of imports(file)) {
    const target = absoluteModule(specifier, file);
    if (!target) continue;
    const targetLayer = layer(target);
    const targetFeature = feature(target);
    const relativeFile = path.relative(ROOT, file).replaceAll(path.sep, "/");
    const relativeTarget = path.relative(SRC, target).replaceAll(path.sep, "/");

    if (
      (sourceLayer === "infrastructure" &&
        ["app", "features", "shared"].includes(targetLayer)) ||
      (sourceLayer === "shared" &&
        ["app", "features", "infrastructure"].includes(targetLayer)) ||
      (sourceLayer === "features" && targetLayer === "app")
    ) {
      violations.push(`${relativeFile}: forbidden ${sourceLayer} -> ${targetLayer} import (${specifier})`);
    }

    if (
      relativeFile.endsWith("/route.ts") &&
      !ROUTE_INFRASTRUCTURE_ALLOWLIST.has(relativeFile) &&
      (relativeTarget === "infrastructure/database/client" ||
        relativeTarget.startsWith("infrastructure/email/"))
    ) {
      violations.push(
        `${relativeFile}: Route Handler must call a feature use case instead of ${specifier}`,
      );
    }

    if (sourceFeature && targetFeature && sourceFeature !== targetFeature) {
      featureGraph.get(sourceFeature).add(targetFeature);
    }
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const featureCycles = new Set();

function visitFeature(current) {
  visiting.add(current);
  stack.push(current);
  for (const dependency of featureGraph.get(current) ?? []) {
    if (visiting.has(dependency)) {
      const start = stack.lastIndexOf(dependency);
      featureCycles.add([...stack.slice(start), dependency].join(" -> "));
    } else if (!visited.has(dependency)) {
      visitFeature(dependency);
    }
  }
  stack.pop();
  visiting.delete(current);
  visited.add(current);
}

for (const current of featureGraph.keys()) {
  if (!visited.has(current)) visitFeature(current);
}

for (const cycle of featureCycles) {
  violations.push(`feature dependency cycle: ${cycle}`);
}

if (violations.length > 0) {
  console.error("architecture violations detected:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

const edgeCount = [...featureGraph.values()].reduce(
  (sum, dependencies) => sum + dependencies.size,
  0,
);
console.log(
  `architecture boundaries valid across ${featureGraph.size} features and ${edgeCount} feature edges`,
);
