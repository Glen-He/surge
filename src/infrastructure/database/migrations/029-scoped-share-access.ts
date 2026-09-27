import type { Migration } from "./migration";

// 成员重加会生成新世代，即使四位短码复用，旧凭证也不会复活。
export const SCOPED_SHARE_ACCESS: Migration = {
  version: 29,
  name: "scoped-share-access",
  statements: [
    `ALTER TABLE report_shares ADD COLUMN access_epoch INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE share_board_items ADD COLUMN access_id TEXT NOT NULL DEFAULT gen_random_uuid()::text`,
    `CREATE UNIQUE INDEX share_board_items_access_id ON share_board_items (access_id)`,
  ],
};
