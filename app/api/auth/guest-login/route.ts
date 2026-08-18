import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  createGuestSessionRecord,
  isGuestExpired,
  purgeStaleGuests,
  seedDemoReports,
  GUEST_TTL_MINUTES,
} from "@/lib/guest-sandbox";
import { ensureOtpMigration } from "@/lib/schema";

export const dynamic = "force-dynamic";

function baseUrl(hs: Headers): string {
  const host = hs.get("x-forwarded-host") ?? hs.get("host") ?? "localhost:3000";
  const proto = hs.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * 点击"游客登录"后调用。
 * 流程：清理过期沙箱 → 通过 better-auth anonymous 插件签发一次性账号和会话 → 灌 5 张示例卡片 → 记录 30 分钟过期 → 返回 Set-Cookie 给前端。
 */
export async function POST(_req: Request) {
  await ensureOtpMigration();

  // Next.js 16 headers() 返回 Promise
  const incomingHeaders = await nextHeaders();

  // IP 频控：每次访客登录都会创建一次性账号 + 5 条报告 + 磁盘目录，
  // 限制同 IP 10 分钟内最多 5 次，防止匿名批量调用耗尽 DB 与磁盘
  const ip =
    incomingHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`guest:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "访客登录过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  // 1) 懒清理：先把所有过期超过 30 分钟的访客沙箱删掉（防止磁盘和 DB 垃圾堆积）
  try { await purgeStaleGuests(); } catch (e) { console.warn("[guest-login] purge", e); }

  // 2) 通过 better-auth anonymous 插件内部端点创建一次性访客 + 签发 session
  const anonUrl = `${baseUrl(incomingHeaders)}/api/auth/sign-in/anonymous`;
  const hs = new Headers({
    "content-type": "application/json",
    "accept": "application/json",
  });
  for (const [k, v] of incomingHeaders.entries()) {
    if (k.toLowerCase() === "cookie" || k.toLowerCase().startsWith("x-forwarded") || k.toLowerCase() === "host") {
      hs.set(k, v);
    }
  }
  hs.set("x-forwarded-proto", incomingHeaders.get("x-forwarded-proto") ?? "http");
  const anonReq = new Request(anonUrl, {
    method: "POST",
    headers: hs,
    body: "{}",
  });
  const anonRes = await auth.handler(anonReq as Request);
  const body = await anonRes.text();

  if (!anonRes.ok) {
    let msg = "访客登录失败，请稍后重试";
    try {
      const j = JSON.parse(body);
      if (j?.message) msg = String(j.message);
    } catch { /* ignore */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let parsed: { user?: { id: string; email: string }; token?: string } | null = null;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  const userId = parsed?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "创建访客账号失败，请稍后重试" },
      { status: 500 },
    );
  }

  // 3) 写入 30 分钟过期元信息 + 灌 5 张示例报告卡片
  try {
    await createGuestSessionRecord(userId, GUEST_TTL_MINUTES);
    await seedDemoReports(userId);
  } catch (e) {
    console.error("[guest-login] seed failed", e);
    // 卡片灌失败也不要把账号留在表里（级联清理）
    const { destroyGuestUser } = await import("@/lib/guest-sandbox");
    try { await destroyGuestUser(userId); } catch { /* ignore */ }
    return NextResponse.json(
      { error: "初始化示例数据失败，请重试" },
      { status: 500 },
    );
  }

  // 4) 转发 better-auth 给的 Set-Cookie（会话 cookie）给前端
  const userEmail = parsed && "user" in parsed && typeof parsed.user === "object" && parsed.user && "email" in parsed.user && typeof (parsed.user as { email?: unknown }).email === "string"
    ? (parsed.user as { email: string }).email
    : "";
  const resp = NextResponse.json({
    ok: true,
    ttlMinutes: GUEST_TTL_MINUTES,
    email: userEmail,
  });
  const setCookies = anonRes.headers.getSetCookie?.() ??
    (anonRes.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? []);
  for (const sc of setCookies) {
    resp.headers.append("set-cookie", sc);
  }
  return resp;
}

// silence unused
void isGuestExpired;
