import { clientIp } from "@/infrastructure/security/client-ip";
import { sendRegistrationOtp } from "@/features/auth/send-registration-otp";
import {
  RegistrationError,
  registrationErrorCopy,
  registrationErrorResponse,
} from "@/features/auth/registration-errors";
import {
  inviteCodeHasValidFormat,
  normalizeInviteCode,
} from "@/features/auth/registration-invites";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    inviteCode?: unknown;
  } | null;
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const inviteCode = normalizeInviteCode(
    typeof body?.inviteCode === "string" ? body.inviteCode : "",
  );
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (inviteCode && !inviteCodeHasValidFormat(inviteCode)) {
    return Response.json(
      { code: "INVITE_FORMAT", error: registrationErrorCopy("INVITE_FORMAT") },
      { status: 400 },
    );
  }

  try {
    await sendRegistrationOtp({
      email,
      inviteCode,
      clientIp: clientIp(request.headers),
      requestUrl: request.url,
      headers: request.headers,
    });
    return Response.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof RegistrationError) {
      const response = registrationErrorResponse(error);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    throw error;
  }
}
