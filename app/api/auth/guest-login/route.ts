import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { consumeSharedRateLimit } from "@/lib/db-rate-limit";
import {
  destroyGuestUser,
  GUEST_TTL_MINUTES,
  guestInternalProof,
  initializeGuestSandbox,
  isGuestEmail,
} from "@/lib/guest-sandbox";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function authEndpointUrl(req: Request): string {
  const configured = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "");
  return `${configured ?? new URL(req.url).origin}/api/auth/sign-in/anonymous`;
}

function setCookieHeaders(headers: Headers): string[] {
  return (
    headers.getSetCookie?.() ??
    (headers.get("set-cookie")?.split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/) ?? [])
  );
}

/**
 * 原子化游客登录边界：
 * 1. 分配账号前先频控；
 * 2. 请 Better Auth 创建匿名用户/会话，但把 Set-Cookie 留在服务端；
 * 3. 单数据库事务内创建固定租约与虚拟演示记录；
 * 4. 全部成功后才把会话 cookie 下发给浏览器。
 *
 * 因此沙箱初始化失败绝不会让浏览器停留在登录了半个游客的状态；
 * 临时用户在返回前即被删除。
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  let guestId: string | null = null;
  let stage = "rate-limit";

  try {
    const rate = await consumeSharedRateLimit(
      "guest-init",
      clientIp(req.headers),
      5,
      10 * 60,
    );
    if (!rate.allowed) {
      logger.warn("guest-login", "guest login rate limited", {
        requestId,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { error: "游客登录过于频繁，请稍后再试" },
        { status: 429 },
      );
    }

    stage = "anonymous-auth";
    const authHeaders = new Headers(req.headers);
    authHeaders.delete("content-length");
    authHeaders.set("content-type", "application/json");
    authHeaders.set("accept", "application/json");
    authHeaders.set("x-surge-guest-proof", guestInternalProof());
    const authResponse = await auth.handler(
      new Request(authEndpointUrl(req), {
        method: "POST",
        headers: authHeaders,
        body: "{}",
      }),
    );
    const authData = (await authResponse.json().catch(() => null)) as
      | { user?: { id?: string; email?: string }; code?: string }
      | null;
    if (!authResponse.ok) {
      logger.warn("guest-login", "better-auth anonymous session creation failed", {
        requestId,
        status: authResponse.status,
        code: authData?.code,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { error: "游客登录失败，请稍后重试" },
        { status: authResponse.status === 429 ? 429 : 503 },
      );
    }

    const userId = authData?.user?.id;
    const email = authData?.user?.email;
    if (!userId || !isGuestEmail(email)) {
      throw new Error("anonymous auth response did not contain a guest user");
    }
    guestId = userId;

    stage = "sandbox-init";
    const expiresAt = await initializeGuestSandbox(userId, GUEST_TTL_MINUTES);

    const response = NextResponse.json({
      ok: true,
      ttlMinutes: GUEST_TTL_MINUTES,
      expiresAt: expiresAt.toISOString(),
    });
    for (const cookie of setCookieHeaders(authResponse.headers)) {
      response.headers.append("set-cookie", cookie);
    }
    response.headers.set("Cache-Control", "no-store");
    logger.info("guest-login", "guest login completed", {
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    if (guestId) {
      try {
        await destroyGuestUser(guestId);
      } catch (cleanupError) {
        logger.error(
          "guest-login",
          "failed to destroy temporary account after init failure",
          cleanupError as Error,
          { requestId, guestId },
        );
      }
    }
    logger.error("guest-login", "guest login failed", error as Error, {
      requestId,
      stage,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "游客登录失败，请稍后重试" },
      { status: 503 },
    );
  }
}
