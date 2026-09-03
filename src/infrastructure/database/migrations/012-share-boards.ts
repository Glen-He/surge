import type { Migration } from "./migration";


// ── v12：多分享面板──
// 一个用户可针对不同查看对象创建多个面板；同一报告可加入多个面板。
// 面板 token 是公开入口，item id 是面板内报告的非业务标识，避免暴露报告 slug。
export const SHARE_BOARDS: Migration = {
  version: 12,
  name: "share-boards",
  statements: [
    `CREATE TABLE IF NOT EXISTS share_boards (
       id            TEXT PRIMARY KEY,
       user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
       token         TEXT NOT NULL UNIQUE,
       title         TEXT NOT NULL,
       password_hash TEXT,
       disabled_at   TIMESTAMPTZ,
       view_count    BIGINT NOT NULL DEFAULT 0,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS share_boards_user
       ON share_boards (user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS share_board_items (
       id         TEXT PRIMARY KEY,
       board_id   TEXT NOT NULL REFERENCES share_boards(id) ON DELETE CASCADE,
       report_id  TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (board_id, report_id)
     )`,
    `CREATE INDEX IF NOT EXISTS share_board_items_board
       ON share_board_items (board_id)`,
    `CREATE INDEX IF NOT EXISTS share_board_items_report
       ON share_board_items (report_id)`,
  ],
};
