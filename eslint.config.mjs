import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/* ── 依赖方向边界（重构后的架构不变量，违反即 CI 失败）──
 * 目标方向：app → features → infrastructure / shared；shared 不依赖任何层。
 * 每个层同时禁止回归旧的 lib/ components/ 中央目录。
 */
const FORBID_LEGACY_PATHS = [
  {
    group: ["@/lib", "@/lib/*", "@/components", "@/components/*"],
    message:
      "lib/ 与 components/ 中央目录已在结构重构中解散，按 feature 归属引用（见 src/features/*）",
  },
];

const boundaryRule = (extra) => ({
  rules: {
    "no-restricted-imports": [
      "error",
      { patterns: [...FORBID_LEGACY_PATHS, ...extra] },
    ],
  },
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 页面或弹窗初始渲染不得默认高亮交互元素。
    rules: { "jsx-a11y/no-autofocus": "error" },
  },
  // 环境变量唯一入口：业务源码禁止直接访问 process.env（否则绕过
  // schema 契约，重新制造"本地能跑、CI/生产漏配"的隐式依赖）。
  // 豁免：environment 模块本身（唯一合法读取点）与测试文件（注入桩）。
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/infrastructure/environment/**", "src/**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "禁止直接访问 process.env：先在 src/infrastructure/environment/schema.ts 注册，再经 serverEnv / frameworkEnv 读取",
        },
      ],
    },
  },
  // src 根（proxy.ts / instrumentation.ts）：只防旧路径回归。
  {
    files: ["src/*.ts"],
    ...boundaryRule([]),
  },
  // infrastructure 是最底层技术设施：不得反向依赖业务层。
  {
    files: ["src/infrastructure/**/*.{ts,tsx}"],
    ...boundaryRule([
      {
        group: ["@/features", "@/features/*", "@/app", "@/app/*", "@/shared", "@/shared/*"],
        message: "infrastructure 不得依赖 features/app/shared（依赖方向：app → features → infrastructure）",
      },
    ]),
  },
  // shared 是纯复用层：不感知任何业务与上层。
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    ...boundaryRule([
      {
        group: ["@/features", "@/features/*", "@/app", "@/app/*", "@/infrastructure", "@/infrastructure/*"],
        message: "shared 不得依赖 features/app/infrastructure（shared 是最底层，只依赖自身与外部库）",
      },
    ]),
  },
  // features 只不得反向依赖 app（delivery 层）。
  {
    files: ["src/features/**/*.{ts,tsx}"],
    ...boundaryRule([
      {
        group: ["@/app", "@/app/*"],
        message: "features 不得依赖 app（app 是最外层 delivery；Server Action 已按 use case 归入各 feature）",
      },
    ]),
  },
  // 覆盖 eslint-config-next 的默认忽略列表。
  globalIgnores([
    // eslint-config-next 的默认忽略项：
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 运行时/客户报告资产是数据，不是应用源码。
    "reports/**",
    "reports_local/**",
    // 本地工作痕迹（迁移方案、一次性脚本），git 已忽略。
    "tmp/**",
  ]),
]);

export default eslintConfig;
