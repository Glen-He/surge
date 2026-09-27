import { db } from "@/infrastructure/database/client";
import { generateShareToken } from "./report-share";
import { encryptShareToken, shareTokenHash } from "./share-credentials";
import { ReportShareError } from "./report-share-errors";
import { withShareTokenRetry } from "./share-token-retry";

/** 保留分享配置与统计，仅轮换链接并撤销这个来源的旧凭证。 */
export async function rotateReportShareToken(userId: string, shareId: string): Promise<string> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ token_hash: string }>(
      `SELECT s.token_hash FROM report_shares s JOIN reports r ON r.id = s.report_id
       WHERE s.id = $1 AND r.user_id = $2 FOR UPDATE OF s`, [shareId, userId],
    );
    if (!current.rows[0]) throw new ReportShareError("SHARE_NOT_FOUND");
    const token = await withShareTokenRetry(client, "report_shares_token_hash_unique", async () => {
      let next: string;
      do { next = generateShareToken(); } while (shareTokenHash(next) === current.rows[0].token_hash);
      await client.query(
        `UPDATE report_shares SET token_hash = $2, token_enc = $3, access_epoch = access_epoch + 1 WHERE id = $1`,
        [shareId, shareTokenHash(next), encryptShareToken(next)],
      );
      return next;
    });
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
