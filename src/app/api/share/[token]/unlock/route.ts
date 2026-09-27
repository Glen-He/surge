import { checkShareLookupRate } from "@/features/sharing/share-lookup-rate";
import { cookies, headers } from "next/headers";
import { serverEnv } from "@/infrastructure/environment/server";
import { clientIp } from "@/infrastructure/security/client-ip";
import {
  checkUnlockRate,
  clearUnlockRate,
  findValidShare,
  recordUnlockFailure,
  unlockCookieName,
  unlockProof,
  verifySharePassword,
} from "@/features/sharing/report-share";

// 密码解锁：校验通过后签发 HMAC 证明 cookie（HttpOnly + Path 绑定本 token）。
// 报告子资源使用 capability，不消费分享 cookie，因此无需把 cookie 扩散到全站。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const ip = clientIp(await headers());
  const lookupRate = await checkShareLookupRate(ip, token);
  if (!lookupRate.allowed) return Response.json(
    { error: `访问过于频繁，请 ${lookupRate.retryAfter} 秒后再试` },
    { status: 429, headers: { "Retry-After": String(lookupRate.retryAfter), "Cache-Control": "no-store" } },
  );
  const found = await findValidShare(token);
  if (!found) {
    return Response.json({ error: "链接无效或已失效" }, { status: 404 });
  }
  if (!found.share.password_hash) {
    return Response.json({ ok: true }); // 无密码无需解锁
  }

  // 限速：每 token 10 分钟窗口 10 次
  const rl = await checkUnlockRate(token, ip);
  if (!rl.ok) {
    return Response.json(
      { error: `尝试次数过多，请 ${rl.retryAfter} 秒后再试` },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const password =
    typeof body.password === "string"
      ? body.password.toUpperCase()
      : "";
  if (
    !password ||
    password.length !== 4 ||
    !(await verifySharePassword(password, found.share.password_hash))
  ) {
    const failureRate = await recordUnlockFailure(token);
    if (!failureRate.ok) {
      return Response.json(
        { error: `尝试次数过多，请 ${failureRate.retryAfter} 秒后再试` },
        { status: 429 },
      );
    }
    return Response.json({ error: "提取码不正确" }, { status: 401 });
  }

  await clearUnlockRate(token, ip);
  const jar = await cookies();
  jar.set(unlockCookieName(token), unlockProof(`share:${token}:${found.share.id}:${found.share.access_epoch}`), {
    httpOnly: true,
    secure: new URL(serverEnv.BETTER_AUTH_URL ?? req.url).protocol === "https:",
    sameSite: "lax",
    path: `/share/${token}`,
    // 会话级：不设 maxAge，关浏览器即失；重新打开需再次输入密码
  });
  return Response.json({ ok: true });
}
