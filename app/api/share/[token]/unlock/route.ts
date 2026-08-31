import { cookies, headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import {
  checkUnlockRate,
  clearUnlockRate,
  findValidShare,
  unlockCookieName,
  unlockProof,
  verifySharePassword,
} from "@/lib/shares";

export const dynamic = "force-dynamic";

// 密码解锁：校验通过后签发 HMAC 证明 cookie（HttpOnly + Path 绑定本 token
// 的两个消费端点都覆盖不到——page 是 GET HTML、asset 是子资源，
// 因此 Path 直接给 /，值本身不可伪造，安全性由 HMAC 保证）。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const found = await findValidShare(token);
  if (!found) {
    return Response.json({ error: "链接无效或已失效" }, { status: 404 });
  }
  if (!found.share.password_hash) {
    return Response.json({ ok: true }); // 无密码无需解锁
  }

  // 限速：每 token 10 分钟窗口 10 次
  const ip = clientIp(await headers());
  const rl = await checkUnlockRate(token, ip);
  if (!rl.ok) {
    return Response.json(
      { error: `尝试次数过多，请 ${rl.retryAfter} 秒后再试` },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (
    !password ||
    password.length > 64 ||
    !(await verifySharePassword(password, found.share.password_hash))
  ) {
    return Response.json({ error: "密码不正确" }, { status: 401 });
  }

  await clearUnlockRate(token, ip);
  const jar = await cookies();
  jar.set(unlockCookieName(token), unlockProof(token), {
    httpOnly: true,
    secure: new URL(process.env.BETTER_AUTH_URL ?? req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    // 会话级：不设 maxAge，关浏览器即失；重新打开需再次输入密码
  });
  return Response.json({ ok: true });
}
