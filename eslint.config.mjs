import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 页面或弹窗初始渲染不得默认高亮交互元素。
    rules: { "jsx-a11y/no-autofocus": "error" },
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
  ]),
]);

export default eslintConfig;
