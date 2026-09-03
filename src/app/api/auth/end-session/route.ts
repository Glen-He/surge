import { cookies as nextCookies } from "next/headers";
import { NextResponse } from "next/server";
import { endSession } from "@/features/session/end-session";
import {
  EndSessionError,
  endSessionErrorResponse,
} from "@/features/session/end-session-errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let result;
  try {
    result = await endSession({
      requestUrl: request.url,
      headers: request.headers,
    });
  } catch (error) {
    if (error instanceof EndSessionError) return endSessionErrorResponse();
    throw error;
  }

  const response = NextResponse.json({ ok: true });
  for (const cookie of result.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  for (const c of (await nextCookies()).getAll()) {
    if (/better_auth|authjs|session/i.test(c.name)) {
      response.cookies.set(c.name, "", {
        expires: new Date(0),
        path: "/",
        secure: result.secureCookie,
        sameSite: "lax",
      });
    }
  }
  return response;
}
