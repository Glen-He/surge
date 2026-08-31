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
 * Atomic guest-login boundary:
 * 1. rate-limit before allocating an account;
 * 2. ask Better Auth to create the anonymous user/session, but retain its
 *    Set-Cookie headers on the server;
 * 3. create the fixed lease and virtual demo rows in one DB transaction;
 * 4. only then forward the session cookie to the browser.
 *
 * A failed sandbox initialization therefore never leaves the browser logged
 * into a half-created guest. The temporary user is deleted before returning.
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
      logger.warn("guest-login", "游客登录频率超限", {
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
      logger.warn("guest-login", "Better Auth 匿名会话创建失败", {
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
    logger.info("guest-login", "游客登录完成", {
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
          "游客初始化失败后销毁临时账号失败",
          cleanupError as Error,
          { requestId, guestId },
        );
      }
    }
    logger.error("guest-login", "游客登录失败", error as Error, {
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
