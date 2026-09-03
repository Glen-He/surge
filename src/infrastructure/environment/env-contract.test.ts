import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  environmentSchema,
  documentedEnvKeys,
  ciRequiredEnvKeys,
  type EnvEntry,
  type EnvVarName,
} from "@/infrastructure/environment/schema";

/* 环境契约三方同步校验（CI 的 environment job 在 1 秒内运行本文件）：
 *   schema ←→ .env.example（开发者文档不漂移）
 *   schema ←→ .github/ci.env（CI 假环境覆盖全部必需变量且格式合法）
 *   schema ←→ 本地 .env.local（存在时校验 always 必需项）
 * 以后新增 XXX_SECRET：未注册 schema / 未写进两份 env 文件，这里直接失败，
 * 而不是等到第 200 个测试或生产启动才炸。
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

  it("CI 假环境覆盖全部必需变量且格式合法", () => {
    const ciEnvFile = path.join(ROOT, ".github", "ci.env");
    expect(existsSync(ciEnvFile), ".github/ci.env 不存在").toBe(true);
    const ciEnv = parseEnvFile(ciEnvFile);

    const required = new Set(ciRequiredEnvKeys);
    const ciKeys = new Set(Object.keys(ciEnv));
    const missing = [...required].filter((k) => !ciKeys.has(k) || ciEnv[k] === "");
    expect(
      missing,
      ".github/ci.env 缺少必需变量（新增变量须同步登记）",
    ).toEqual([]);

    // ci.env 中的每个 schema 变量值都必须合法
    for (const [key, value] of Object.entries(ciEnv)) {
      const entry = (environmentSchema as Record<string, EnvEntry | undefined>)[key];
      if (!entry) continue; // 未知键在下方断言捕获
      checkValue(key as EnvVarName, entry, value);
    }
    const unknown = Object.keys(ciEnv).filter(
      (k) => !(k in environmentSchema),
    );
    expect(unknown, "ci.env 存在未注册 schema 的变量").toEqual([]);
  });

  it(
    "本地 .env.local 满足 always 必需项（存在时才校验）",
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

  it(
    "CI 运行器实际进程环境覆盖必需变量（防御 env 加载步骤失效）",
    // 用 GITHUB_ACTIONS 而非 CI：本地 shell（含代理 harness）也可能设置 CI=true
    { skip: process.env.GITHUB_ACTIONS !== "true" },
    () => {
      const required = new Set(ciRequiredEnvKeys);
      const missing = [...required].filter(
        (k) => process.env[k] === undefined || process.env[k]?.trim() === "",
      );
      expect(
        missing,
        ".github/ci.env 已通过 GITHUB_ENV 加载，但进程环境仍缺必需变量",
      ).toEqual([]);
    },
  );
});
