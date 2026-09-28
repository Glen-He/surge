import { db } from "@/infrastructure/database/client";
import type { DisplayMode } from "../display-mode";
import type { verifyCapability } from "../report-capability";

/** 核对报告版本及授权来源；缓存命中之前也必须逐次执行。 */
export async function authorizeReportResource(
  grant: NonNullable<ReturnType<typeof verifyCapability>>,
) {
  // 每次请求先校验内容版本与授权来源，再处理缓存和文件流；
  // 分享撤销与面板成员变化只使对应来源失效，内容替换仍使全部旧凭证失效。
  const r = await db.query<{
    display_mode: DisplayMode;
    user_id: string;
    revision_id: string;
    capability_epoch: number;
    template_key: string | null;
    storage_key: string | null;
  }>(
    `SELECT user_id, revision_id, capability_epoch, template_key, storage_key, display_mode
     FROM reports r WHERE r.id = $1
       AND ($2 = 'owner'
         OR ($2 = 'share' AND EXISTS (
           SELECT 1 FROM report_shares s WHERE s.id = $3 AND s.report_id = r.id
             AND s.access_epoch = $4 AND s.disabled_at IS NULL
             AND (s.expires_at IS NULL OR s.expires_at > NOW())
         ))
         OR ($2 = 'board' AND EXISTS (
           SELECT 1 FROM share_board_items i JOIN share_boards b ON b.id = i.board_id
            WHERE i.access_id = $3 AND i.report_id = r.id AND b.access_epoch = $4
              AND b.disabled_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > NOW())
         ))) LIMIT 1`,
    [
      grant.reportId,
      grant.source.kind,
      grant.source.kind === "owner" ? null : grant.source.id,
      grant.source.kind === "owner" ? 0 : grant.source.epoch,
    ],
  );
  const row = r.rows[0];
  if (
    !row ||
    row.revision_id !== grant.revisionId ||
    row.capability_epoch !== grant.epoch
  ) {
    return null;
  }

  return row;
}
