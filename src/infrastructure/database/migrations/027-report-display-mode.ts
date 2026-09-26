import type { Migration } from "./migration";

// 存量报告保持汇报展示；数据库约束阻止未知模式进入运行时。
export const REPORT_DISPLAY_MODE: Migration = {
  version: 27,
  name: "report-display-mode",
  statements: [
    `ALTER TABLE reports ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'frame'
       CONSTRAINT reports_display_mode_valid CHECK (display_mode IN ('frame', 'bare'))`,
  ],
};
