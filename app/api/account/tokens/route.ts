import { getApiSession } from "@/lib/api-session";
import { clientIp } from "@/lib/client-ip";
import { consumeSharedRateLimit } from "@/lib/db-rate-limit";
import { logger } from "@/lib/logger";
import {
  type ApiTokenErrorCode,
  createApiToken,
  getApiToken,
  revokeApiToken,
  rotateApiToken,
} from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

const API_TOKEN_ERRORS: Record<
  ApiTokenErrorCode,
  { status: number; message: string }
> = {
  GUEST_UNSUPPORTED: {
    status: 403,
    message: "游客模式不支持 API 令牌，注册正式账号后可用",
  },
  TOKEN_ALREADY_EXISTS: {
    status: 409,
    message: "已有令牌（每账号一个），可更换或撤销后重建",
  },
};

function apiTokenErrorResponse(code: ApiTokenErrorCode): Response {
  const error = API_TOKEN_ERRORS[code];
  return Response.json({ error: error.message }, { status: error.status });
}

// API 令牌管理（会话认证）：单令牌密钥面板
// GET    → 当前令牌元数据（明文只在创建/更换时返回一次）
// POST   → 创建（无令牌时）
// PATCH  → 更换（旧值立即失效，返回新明文）
// DELETE → 撤销（?id=）

async function sessionUser() {
  return (await getApiSession()) ?? null;
}

async function guard(
  userId: string,
  ip: string,
  action: string,
): Promise<Response | null> {
  // 同一用户 30 次变更 / 10 分钟（创建/更换/撤销共用）：正常使用打不满，仅防脚本滥用
  const result = await consumeSharedRateLimit(
    "api-token-mutate",
    userId,
    30,
    10 * 60,
  );
  if (!result.allowed) {
    logger.warn("api-token", "token action rate limited", { action, userId, ip });
    return Response.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }
  return null;
}

export async function GET() {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const result = await getApiToken(session.user.id);
  if (!result) return Response.json({ token: null });
  return Response.json({
    token: {
      id: result.id,
      prefix: result.prefix,
      createdAt: result.createdAt,
      lastUsedAt: result.lastUsedAt,
    },
  });
}

export async function POST(req: Request) {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const ip = clientIp(req.headers);
  const limited = await guard(session.user.id, ip, "创建");
  if (limited) return limited;

  const result = await createApiToken(session.user.id, session.user.email);
  if ("errorCode" in result) {
    return apiTokenErrorResponse(result.errorCode);
  }
  logger.info("api-token", "token created via account settings", {
    userId: session.user.id,
    ip,
  });
  return Response.json({
    token: {
      id: result.token.id,
      token: result.token.token,
      prefix: result.token.prefix,
      createdAt: result.token.createdAt,
      lastUsedAt: null,
    },
  });
}

export async function PATCH(req: Request) {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const ip = clientIp(req.headers);
  const limited = await guard(session.user.id, ip, "更换");
  if (limited) return limited;

  const result = await rotateApiToken(session.user.id, session.user.email);
  if ("errorCode" in result) {
    return apiTokenErrorResponse(result.errorCode);
  }
  return Response.json({
    token: {
      id: result.token.id,
      token: result.token.token,
      prefix: result.token.prefix,
      createdAt: result.token.createdAt,
      lastUsedAt: null,
    },
  });
}

export async function DELETE(req: Request) {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const ip = clientIp(req.headers);
  const limited = await guard(session.user.id, ip, "撤销");
  if (limited) return limited;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    // 未传 id：撤销当前令牌
    const cur = await getApiToken(session.user.id);
    if (!cur) {
      return Response.json({ error: "没有可撤销的令牌" }, { status: 404 });
    }
    await revokeApiToken(session.user.id, cur.id);
    return Response.json({ ok: true });
  }
  const ok = await revokeApiToken(session.user.id, id);
  if (!ok) return Response.json({ error: "令牌不存在" }, { status: 404 });
  return Response.json({ ok: true });
}
