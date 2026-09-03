import { db } from "@/infrastructure/database/client";

export type AccountSessionSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
};

type SessionRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

/** 只返回设备管理页面需要的会话字段，绝不把 bearer token 传给前端。 */
export async function listActiveAccountSessions(
  userId: string,
  currentSessionId: string,
): Promise<AccountSessionSummary[]> {
  const result = await db.query<SessionRow>(
    `SELECT id, "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent"
       FROM "session"
      WHERE "userId" = $1 AND "expiresAt" > NOW()
      ORDER BY (id = $2) DESC, "updatedAt" DESC, "createdAt" DESC`,
    [userId, currentSessionId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ipAddress: row.ipAddress || null,
    userAgent: row.userAgent || null,
    current: row.id === currentSessionId,
  }));
}

/** 撤销一个属于当前用户的其他会话；当前会话必须走统一登出入口清理 Cookie。 */
export async function revokeOwnedAccountSession(opts: {
  userId: string;
  currentSessionId: string;
  targetSessionId: string;
}): Promise<"revoked" | "current" | "not-found"> {
  if (opts.targetSessionId === opts.currentSessionId) return "current";

  const result = await db.query(
    `DELETE FROM "session"
      WHERE id = $1 AND "userId" = $2 AND id <> $3`,
    [opts.targetSessionId, opts.userId, opts.currentSessionId],
  );
  return result.rowCount === 1 ? "revoked" : "not-found";
}

/** 一次撤销当前用户除当前会话外的全部活跃或过期会话。 */
export async function revokeOtherAccountSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const result = await db.query(
    `DELETE FROM "session" WHERE "userId" = $1 AND id <> $2`,
    [userId, currentSessionId],
  );
  return result.rowCount ?? 0;
}
