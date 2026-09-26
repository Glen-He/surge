import type { Migration } from "./migration";

// 条目标识只在面板内唯一，直接替换旧值；不保留旧链接映射。
export const BOARD_ITEM_SHORT_ID: Migration = {
  version: 28,
  name: "board-item-short-id",
  statements: [
    `ALTER TABLE share_board_items DROP CONSTRAINT share_board_items_pkey,
       ADD PRIMARY KEY (board_id, id)`,
    `DO $$
     DECLARE
       item RECORD;
       short_id TEXT;
     BEGIN
       FOR item IN SELECT board_id, id FROM share_board_items LOOP
         LOOP
           SELECT string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789',
                    1 + floor(random() * 36)::int, 1), '' ORDER BY n)
             INTO short_id FROM generate_series(1, 4) AS chars(n);
           EXIT WHEN NOT EXISTS (
             SELECT 1 FROM share_board_items
              WHERE board_id = item.board_id AND id = short_id
           );
         END LOOP;
         UPDATE share_board_items SET id = short_id
          WHERE board_id = item.board_id AND id = item.id;
       END LOOP;
     END $$`,
    `ALTER TABLE share_board_items ADD CONSTRAINT share_board_items_id_format
       CHECK (id ~ '^[a-z0-9]{4}$')`,
    // 联合主键的前导列已支持按面板查询，无需保留重复索引。
    `DROP INDEX share_board_items_board`,
  ],
};
