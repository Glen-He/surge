import { NextResponse } from "next/server";
import { auth } from "@/features/auth/auth";
import { toChineseError } from "@/features/auth/auth-errors";
import { clientIp } from "@/infrastructure/security/client-ip";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import {
  getRegistrationPolicy,
  registrationInternalProof,
} from "@/features/auth/registration-policy";
import {
  inviteCodeHasValidFormat,
  normalizeInviteCode,
  validateRegistrationInvite,
} from "@/features/auth/registration-invites";
import { registrationErrorCopy } from "@/features/auth/registration-errors";

export const dynamic = "force-dynamic";

function authEndpointUrl(req: Request): string {
  const configured = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "");
  return `${configured ?? new URL(req.url).origin}/api/auth/email-otp/send-verification-otp`;
}

export async function POST(req: Request) {
  const policy = await getRegistrationPolicy();
  if (!policy.enabled) {
    return NextResponse.json(
      { error: registrationErrorCopy("REGISTRATION_CLOSED") },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    email?: unknown;
    inviteCode?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const inviteCode = normalizeInviteCode(
    typeof body?.inviteCode === "string" ? body.inviteCode : "",
  );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }

  // 持久化的滥用防护位于 SMTP 之前，且跨所有 Node 实例生效；
  // 邮箱维度的冷却仍由 auth.ts 执行。
  const ip = clientIp(req.headers);
  const [address, global] = await Promise.all([
    consumeSharedRateLimit("registration-otp-ip", ip, 8, 60 * 60),
    consumeSharedRateLimit("registration-otp-global", "global", 200, 24 * 60 * 60),
  ]);
  if (!address.allowed || !global.allowed) {
    return NextResponse.json(
      { error: "验证码发送过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  if (policy.inviteRequired && !inviteCode) {
    return NextResponse.json(
      { code: "INVITE_REQUIRED", error: registrationErrorCopy("INVITE_REQUIRED") },
      { status: 400 },
    );
  }
  if (inviteCode && !inviteCodeHasValidFormat(inviteCode)) {
    return NextResponse.json(
      { code: "INVITE_FORMAT", error: registrationErrorCopy("INVITE_FORMAT") },
      { status: 400 },
    );
  }
  if (inviteCode && !(await validateRegistrationInvite(inviteCode))) {
    return NextResponse.json(
      { code: "INVITE_INVALID", error: registrationErrorCopy("INVITE_INVALID") },
      { status: 400 },
    );
  }

  const authHeaders = new Headers(req.headers);
  authHeaders.delete("content-length");
  authHeaders.set("content-type", "application/json");
  authHeaders.set("accept", "application/json");
  authHeaders.set("x-surge-registration-proof", registrationInternalProof(email));
  const response = await auth.handler(
    new Request(authEndpointUrl(req), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
  );
  const data = (await response.json().catch(() => null)) as
    | { code?: string; error?: { code?: string } }
    | null;
  const headers = { "Cache-Control": "no-store" };
  if (response.ok) {
    return NextResponse.json(data ?? { success: true }, {
      status: response.status,
      headers,
    });
  }
  return NextResponse.json(
    { error: toChineseError({ code: data?.code ?? data?.error?.code }) },
    { status: response.status, headers },
  );
}
