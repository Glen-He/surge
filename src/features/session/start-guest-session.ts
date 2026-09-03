import { randomUUID } from "node:crypto";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import {
  authSetCookies,
  internalAuthBaseUrl,
  internalAuthHeaders,
} from "@/infrastructure/auth/internal-auth-request";
import { logger } from "@/infrastructure/logging/logger";
import { clientIp } from "@/infrastructure/security/client-ip";
import {
  destroyGuestUser,
  initializeGuestSandbox,
} from "@/features/guest/guest-sandbox";
import { auth } from "@/features/auth/auth";
import {
  GUEST_TTL_MINUTES,
  guestInternalProof,
  isGuestEmail,
} from "@/features/auth/guest/guest-identity";
import { GuestLoginError } from "@/features/auth/guest/guest-login-errors";

export type GuestSessionResult = {
  ttlMinutes: number;
  expiresAt: Date;
  setCookies: string[];
};

/**
 * 创建匿名会话并初始化隔离沙箱；只有两步都成功时才把 Cookie 交给交付层。
 * 沙箱初始化失败时会先销毁刚创建的临时账号。
 */
export async function startGuestSession(input: {
  requestUrl: string;
  headers: Headers;
}): Promise<GuestSessionResult> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  let guestId: string | null = null;
  let stage = "rate-limit";

  try {
    const rate = await consumeSharedRateLimit(
      "guest-init",
      clientIp(input.headers),
      5,
      10 * 60,
    );
    if (!rate.allowed) {
      logger.warn("guest-login", "guest login rate limited", {
        requestId,
        durationMs: Date.now() - startedAt,
      });
      throw new GuestLoginError("GUEST_LOGIN_RATE_LIMIT");
    }

    stage = "anonymous-auth";
    const headers = internalAuthHeaders(input.headers);
    headers.set("x-surge-guest-proof", guestInternalProof());
    const authResponse = await auth.handler(
      new Request(`${internalAuthBaseUrl(input.requestUrl)}/api/auth/sign-in/anonymous`, {
        method: "POST",
        headers,
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
      throw new GuestLoginError(
        authResponse.status === 429
          ? "GUEST_AUTH_RATE_LIMIT"
          : "GUEST_LOGIN_UNAVAILABLE",
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
    logger.info("guest-login", "guest login completed", {
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return {
      ttlMinutes: GUEST_TTL_MINUTES,
      expiresAt,
      setCookies: authSetCookies(authResponse.headers),
    };
  } catch (error) {
    if (guestId) {
      try {
        await destroyGuestUser(guestId);
      } catch (cleanupError) {
        logger.error(
          "guest-login",
          "failed to destroy temporary account after initialization failure",
          cleanupError as Error,
          { requestId, guestId },
        );
      }
    }
    if (error instanceof GuestLoginError) throw error;
    logger.error("guest-login", "guest login failed", error as Error, {
      requestId,
      stage,
      durationMs: Date.now() - startedAt,
    });
    throw new GuestLoginError("GUEST_LOGIN_UNAVAILABLE");
  }
}
