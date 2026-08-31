import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toChineseError } from "@/lib/auth-errors";
import { clientIp } from "@/lib/client-ip";
import { consumeSharedRateLimit } from "@/lib/db-rate-limit";
import {
  registrationInternalProof,
  registrationIsOpen,
} from "@/lib/registration-policy";

export const dynamic = "force-dynamic";

function authEndpointUrl(req: Request): string {
  const configured = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "");
  return `${configured ?? new URL(req.url).origin}/api/auth/email-otp/send-verification-otp`;
}

export async function POST(req: Request) {
  if (!registrationIsOpen()) {
    return NextResponse.json({ error: "当前未开放新账号注册" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
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
