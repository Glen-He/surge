import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  createApiToken,
  getApiToken,
  revokeApiToken,
  rotateApiToken,
} from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

// API 令牌管理（会话认证）：单令牌密钥面板
// GET    → 当前令牌（含明文，供显示/隐藏/复制）
// POST   → 创建（无令牌时）
// PATCH  → 更换（旧值立即失效，返回新明文）
// DELETE → 撤销（?id=）

async function sessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ?? null;
}

function guard(
  userId: string,
  ip: string,
  action: string,
): Response | null {
  // 同一用户 30 次变更 / 10 分钟（创建/更换/撤销共用）：正常使用打不满，仅防脚本滥用
  if (!rateLimit(`api-token-mutate:${userId}`, 30, 10 * 60 * 1000)) {
    logger.warn("api-token", `${action} 过于频繁`, { userId, ip });
    return Response.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }
  return null;
}

export async function GET() {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const result = await getApiToken(session.user.id);
  if (!result) return Response.json({ token: null });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 500 });
  }
  return Response.json({
    token: {
      id: result.id,
      token: result.token,
      createdAt: result.createdAt,
      lastUsedAt: result.lastUsedAt,
    },
  });
}

export async function POST(req: Request) {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const ip = clientIp(req.headers);
  const limited = guard(session.user.id, ip, "创建");
  if (limited) return limited;

  const result = await createApiToken(session.user.id, session.user.email);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  logger.info("api-token", "令牌创建", { userId: session.user.id, ip });
  return Response.json({
    token: {
      id: result.token.id,
      token: result.token.token,
      createdAt: result.token.createdAt,
      lastUsedAt: null,
    },
  });
}

export async function PATCH(req: Request) {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const ip = clientIp(req.headers);
  const limited = guard(session.user.id, ip, "更换");
  if (limited) return limited;

  const result = await rotateApiToken(session.user.id, session.user.email);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({
    token: {
      id: result.token.id,
      token: result.token.token,
      createdAt: result.token.createdAt,
      lastUsedAt: null,
    },
  });
}

export async function DELETE(req: Request) {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const ip = clientIp(req.headers);
  const limited = guard(session.user.id, ip, "撤销");
  if (limited) return limited;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    // 未传 id：撤销当前令牌
    const cur = await getApiToken(session.user.id);
    if (!cur || "error" in cur) {
      return Response.json({ error: "没有可撤销的令牌" }, { status: 404 });
    }
    await revokeApiToken(session.user.id, cur.id);
    return Response.json({ ok: true });
  }
  const ok = await revokeApiToken(session.user.id, id);
  if (!ok) return Response.json({ error: "令牌不存在" }, { status: 404 });
  return Response.json({ ok: true });
}
