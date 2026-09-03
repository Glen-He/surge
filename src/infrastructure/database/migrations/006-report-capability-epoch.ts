import type { Migration } from "./migration";


// ── v6：报告 capability 纪元（撤销语义）──
// capability 只绑 reportId+revisionId 时，撤销分享后已签发的 capability
// 在 TTL 内仍有效（权限在父页签发时裁决，runtime 无法追溯）。epoch 是
// 报告级吊销开关：撤销分享等权限变化时 +1，runtime 要求 cap.epoch 与
// DB 当前值一致，旧 capability 立即整体失效（副作用：该报告所有 cap
// 失效，刷新父页即重新签发，属可接受的简单化）。
export const REPORT_CAP_EPOCH: Migration = {
  version: 6,
  name: "report-capability-epoch",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS capability_epoch
       INTEGER NOT NULL DEFAULT 0`,
  ],
};
