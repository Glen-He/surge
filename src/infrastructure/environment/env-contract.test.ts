import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  environmentSchema,
  documentedEnvKeys,
  type EnvEntry,
  type EnvVarName,
} from "@/infrastructure/environment/schema";

/* 环境契约校验：
 *   schema ←→ .env.example（开发者文档不漂移）
 *   schema ←→ 本地 .env.local（存在时校验始终必需项）
 * 新增必需密钥时，未注册 schema 或未写进 .env.example 都会在本地检查中失败。
 */

const ROOT = process.cwd();

/** 解析 .env 格式文件为键值表（跳过注释与空行，容忍引号包裹） */
function parseEnvFile(file: string): Record<string, string> {
  const content = readFileSync(file, "utf8");
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** 按 schema 校验单个值（与 serverEnv 同口径的简化版） */
function checkValue(name: EnvVarName, entry: EnvEntry, value: string) {
  if (entry.type === "int") {
    const parsed = Number(value);
    expect(
      Number.isSafeInteger(parsed) &&
        (entry.min === undefined || parsed >= entry.min) &&
        (entry.max === undefined || parsed <= entry.max),
      `${name}=${value} 不是合法整数或超出范围`,
    ).toBe(true);
    return;
  }
  if (value === "") return; // 留空（本地可选配置）由 required 语义另行处理
  if (entry.minLength !== undefined) {
    expect(
      value.length >= entry.minLength,
      `${name} 长度不足 ${entry.minLength}（当前 ${value.length}）`,
    ).toBe(true);
  }
  if (entry.enum) {
    expect(entry.enum.includes(value), `${name}=${value} 不在枚举内`).toBe(true);
  }
}

describe("环境契约", () => {
  it(".env.example 与 schema 完全同步（双向无缺漏）", () => {
    const example = parseEnvFile(path.join(ROOT, ".env.example"));
    const documented = new Set<string>(documentedEnvKeys);
    const exampleKeys = new Set(Object.keys(example));

    const missingInExample = [...documented].filter((k) => !exampleKeys.has(k));
    const extraInExample = [...exampleKeys].filter((k) => !documented.has(k));
    expect(
      missingInExample,
      "schema 已注册但 .env.example 缺失（开发者文档漂移）",
    ).toEqual([]);
    expect(
      extraInExample,
      ".env.example 存在未注册 schema 的变量（先在 schema.ts 注册）",
    ).toEqual([]);

    // 文档值本身也要通过格式校验（如 SMTP_PORT=465）
    for (const key of documentedEnvKeys) {
      checkValue(key, environmentSchema[key], example[key] ?? "");
    }
  });

  it(
    "本地 .env.local 满足始终必需项（存在时才校验）",
    { skip: !existsSync(path.join(ROOT, ".env.local")) },
    () => {
      const local = parseEnvFile(path.join(ROOT, ".env.local"));
      const alwaysKeys = (Object.keys(environmentSchema) as EnvVarName[]).filter(
        (k) => environmentSchema[k].required === "always",
      );
      const problems: string[] = [];
      for (const key of alwaysKeys) {
        const value = local[key] ?? "";
        const entry = environmentSchema[key] as EnvEntry;
        const min = entry.minLength ?? 1;
        if (value.trim().length < min) {
          problems.push(`${key} 缺失或短于 ${min} 字符`);
        }
      }
      expect(problems, "本地 .env.local 不满足环境契约").toEqual([]);
    },
  );

});
