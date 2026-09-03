import { NextResponse } from "next/server";
import {
  GuestLoginError,
  guestLoginErrorResponse,
} from "@/features/auth/guest/guest-login-errors";
import {
  startGuestSession,
} from "@/features/session/start-guest-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const result = await startGuestSession({
      requestUrl: req.url,
      headers: req.headers,
    });
    const response = NextResponse.json({
      ok: true,
      ttlMinutes: result.ttlMinutes,
      expiresAt: result.expiresAt.toISOString(),
    });
    for (const cookie of result.setCookies) {
      response.headers.append("set-cookie", cookie);
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof GuestLoginError) return guestLoginErrorResponse(error);
    throw error;
  }
}
