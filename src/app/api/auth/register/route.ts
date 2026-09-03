import { NextResponse } from "next/server";
import { clientIp } from "@/infrastructure/security/client-ip";
import { OTP_CODE_FORMAT_ERROR } from "@/features/auth/auth-errors";
import { isOtpCode } from "@/features/auth/otp-code";
import { passwordPolicyError } from "@/features/auth/password-policy";
import { registerAccount } from "@/features/auth/register-account";
import {
  RegistrationError,
  registrationErrorCopy,
  registrationErrorResponse,
} from "@/features/auth/registration-errors";
import {
  inviteCodeHasValidFormat,
  normalizeInviteCode,
} from "@/features/auth/registration-invites";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    otp?: unknown;
    password?: unknown;
    inviteCode?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const inviteCode = normalizeInviteCode(
    typeof body?.inviteCode === "string" ? body.inviteCode : "",
  );

  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  const passwordError = passwordPolicyError(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }
  if (!isOtpCode(otp)) {
    return NextResponse.json({ error: OTP_CODE_FORMAT_ERROR }, { status: 400 });
  }
  if (inviteCode && !inviteCodeHasValidFormat(inviteCode)) {
    return NextResponse.json(
      { code: "INVITE_FORMAT", error: registrationErrorCopy("INVITE_FORMAT") },
      { status: 400 },
    );
  }

  try {
    const result = await registerAccount({
      email,
      otp,
      password,
      inviteCode,
      clientIp: clientIp(request.headers),
      requestUrl: request.url,
      headers: request.headers,
    });
    const response = NextResponse.json({ ok: true });
    for (const cookie of result.setCookies) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  } catch (error) {
    if (error instanceof RegistrationError) {
      return registrationErrorResponse(error);
    }
    throw error;
  }
}
