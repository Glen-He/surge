import { getApiSession } from "@/features/auth/api-session";
import { clientIp } from "@/infrastructure/security/client-ip";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { logger } from "@/infrastructure/logging/logger";
import {
  type ApiTokenErrorCode,
  createApiToken,
  getApiToken,
  revokeCurrentApiToken,
  rotateApiToken,
} from "@/features/account/api-tokens";

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
// GET    → 当前令牌（会话属主可随时查看）
// POST   → 创建（无令牌时）
// PATCH  → 更换（旧值立即失效，返回新明文）
// DELETE → 撤销当前令牌

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
  return Response.json(
    {
      token: result,
      error:
        result && !result.token
          ? "令牌无法显示，请更换或撤销后重新生成"
          : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  return Response.json(
    { token: result.token },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  return Response.json(
    { token: result.token },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(req: Request) {
  const session = await sessionUser();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });

  const ip = clientIp(req.headers);
  const limited = await guard(session.user.id, ip, "撤销");
  if (limited) return limited;

  const ok = await revokeCurrentApiToken(session.user.id);
  if (!ok) return Response.json({ error: "没有可撤销的令牌" }, { status: 404 });
  return Response.json({ ok: true });
}
