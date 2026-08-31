import { getApiSession } from "@/lib/api-session";
import { db } from "@/lib/db";
import { ensureOtpMigration } from "@/lib/schema";
import { isGuestEmail } from "@/lib/guest-sandbox";
import {
  generateShareId,
  generateShareToken,
  hashSharePassword,
  listSharesBySlug,
} from "@/lib/shares";
import { encryptShareToken, shareTokenHash } from "@/lib/share-token-store";

export const dynamic = "force-dynamic";

// 分享管理（属主侧）：列出 / 创建。撤销在 /api/shares/[id]。
// 报告归属从 session 推导，slug 不属于当前用户一律 404。

const EXPIRY_DAYS = [1, 7, 30, 0]; // 0 = 永久

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const { slug } = await params;
  const rows = await listSharesBySlug(session.user.id, slug);
  return Response.json({
    shares: rows.map((s) => ({
      id: s.id,
      token: s.token,
      hasPassword: !!s.password_hash,
      expiresAt: s.expires_at,
      revokedAt: s.revoked_at,
      viewCount: Number(s.view_count),
      createdAt: s.created_at,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getApiSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  // 访客报告随沙箱销毁，禁止分享（避免死链与演示数据外泄）
  if (isGuestEmail(session.user.email)) {
    return Response.json(
      { error: "访客模式不支持分享" },
      { status: 403 },
    );
  }

  const { slug } = await params;

  const body = await req.json().catch(() => ({}));
  const password =
    typeof body.password === "string" && body.password.trim()
      ? body.password.trim()
      : null;
  if (password && (password.length < 8 || password.length > 64)) {
    return Response.json(
      { error: "密码长度需在 8 ~ 64 位之间" },
      { status: 400 },
    );
  }
  const days = Number(body.expiresInDays ?? 0);
  if (!EXPIRY_DAYS.includes(days)) {
    return Response.json({ error: "无效的有效期" }, { status: 400 });
  }
  const expiresAt =
    days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
  // scrypt is intentionally expensive and synchronous; compute it before the
  // transaction so it does not hold the report row lock or a DB connection.
  const passwordHash = password ? await hashSharePassword(password) : null;

  // 上限 5 条/报告：count + insert 放进同一事务并锁报告行（FOR UPDATE），
  // 并发创建会在锁上排队，杜绝「多个请求同时通过检查、插入第 6 条」的竞态。
  // 撤销是物理删除，删除后名额立即释放。
  await ensureOtpMigration();
  const client = await db.connect();
  let id: string;
  let token: string;
  try {
    await client.query("BEGIN");
    const own = await client.query<{ id: string }>(
      `SELECT id FROM reports WHERE user_id = $1 AND slug = $2 LIMIT 1 FOR UPDATE`,
      [session.user.id, slug],
    );
    const reportId = own.rows[0]?.id ?? null;
    if (!reportId) {
      await client.query("ROLLBACK");
      return Response.json({ error: "报告不存在" }, { status: 404 });
    }
    const existing = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM report_shares WHERE report_id = $1`,
      [reportId],
    );
    if (Number(existing.rows[0]?.n ?? 0) >= 5) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "最多 5 条分享链接，撤销旧链接后可再次创建" },
        { status: 400 },
      );
    }
    id = generateShareId();
    token = generateShareToken();
    await client.query(
      `INSERT INTO report_shares
         (id, report_id, token_hash, token_enc, password_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, reportId, shareTokenHash(token), encryptShareToken(token), passwordHash, expiresAt],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return Response.json({
    ok: true,
    share: {
      id,
      token,
      hasPassword: !!password,
      expiresAt,
      revokedAt: null,
      viewCount: 0,
      createdAt: new Date(),
    },
  });
}
