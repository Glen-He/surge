import type { Migration } from "./index";


// ── v24：删除报告外部网络能力──
// 汇报只允许加载当前 capability 目录内的资源；普通用户触发的新标签页
// 外链由 sandbox 独立放行，不依赖数据库开关。
export const REMOVE_REPORT_EXTERNAL_NETWORK: Migration = {
  version: 24,
  name: "remove-report-external-network",
  statements: [
    `ALTER TABLE reports DROP COLUMN IF EXISTS external_network_enabled`,
  ],
};
