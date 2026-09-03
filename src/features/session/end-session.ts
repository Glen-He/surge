import {
  authSetCookies,
  internalAuthBaseUrl,
  internalAuthHeaders,
} from "@/infrastructure/auth/internal-auth-request";
import { logger } from "@/infrastructure/logging/logger";
import { internalAuthProof } from "@/infrastructure/security/internal-auth-proof";
import { auth } from "@/features/auth/auth";
import { isGuestEmail } from "@/features/auth/guest/guest-identity";
import { destroyGuestUser } from "@/features/guest/guest-sandbox";
import { EndSessionError } from "./end-session-errors";

export type EndSessionResult = {
  setCookies: string[];
  secureCookie: boolean;
};

/**
 * 终止当前会话。游客必须先销毁账号与沙箱；正式用户交由 Better Auth
 * 撤销服务端会话。失败时保留原会话，让用户可以重试。
 */
export async function endSession(input: {
  requestUrl: string;
  headers: Headers;
}): Promise<EndSessionResult> {
  const session = await auth.api.getSession({ headers: input.headers });
  const guestId =
    session && isGuestEmail(session.user.email) ? session.user.id : null;

  if (guestId) {
    try {
      await destroyGuestUser(guestId);
    } catch (error) {
      logger.error(
        "end-session",
        "failed to destroy guest sandbox",
        error as Error,
        { guestId },
      );
      throw new EndSessionError();
    }
  }

  const baseUrl = internalAuthBaseUrl(input.requestUrl);
  if (guestId) {
    return {
      setCookies: [],
      secureCookie: new URL(baseUrl).protocol === "https:",
    };
  }

  const headers = internalAuthHeaders(input.headers);
  headers.set("x-surge-end-session-proof", internalAuthProof("end-session"));
  try {
    const response = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-out`, {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    await response.text();
    if (!response.ok) {
      logger.error("end-session", "server-side sign-out failed", {
        status: response.status,
      });
      throw new EndSessionError();
    }
    return {
      setCookies: authSetCookies(response.headers),
      secureCookie: new URL(baseUrl).protocol === "https:",
    };
  } catch (error) {
    if (!(error instanceof EndSessionError)) {
      logger.error("end-session", "server-side sign-out threw", error as Error);
    }
    throw new EndSessionError();
  }
}
