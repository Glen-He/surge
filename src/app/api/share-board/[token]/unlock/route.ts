import { checkShareLookupRate } from "@/features/sharing/share-lookup-rate";
import { cookies, headers } from "next/headers";
import { serverEnv } from "@/infrastructure/environment/server";
import { clientIp } from "@/infrastructure/security/client-ip";
import { boardUnlockCookieName, boardUnlockProof, findPublicShareBoard } from "@/features/sharing/public-share-board";
import {
  checkUnlockRate,
  clearUnlockRate,
  recordUnlockFailure,
  verifySharePassword,
} from "@/features/sharing/report-share";

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
  const board = await findPublicShareBoard(token);
  if (!board) return Response.json({ error: "面板无效或已停用" }, { status: 404 });
  if (!board.passwordHash) return Response.json({ ok: true });

  const rateKey = `board:${token}`;
  const rate = await checkUnlockRate(rateKey, ip);
  if (!rate.ok) {
    return Response.json(
      { error: `尝试次数过多，请 ${rate.retryAfter} 秒后再试` },
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
    !(await verifySharePassword(password, board.passwordHash))
  ) {
    const failureRate = await recordUnlockFailure(rateKey);
    if (!failureRate.ok) {
      return Response.json(
        { error: `尝试次数过多，请 ${failureRate.retryAfter} 秒后再试` },
        { status: 429 },
      );
    }
    return Response.json({ error: "提取码不正确" }, { status: 401 });
  }
  await clearUnlockRate(rateKey, ip);
  const jar = await cookies();
  jar.set(boardUnlockCookieName(token), boardUnlockProof(token, board.accessEpoch), {
    httpOnly: true,
    secure: new URL(serverEnv.BETTER_AUTH_URL ?? req.url).protocol === "https:",
    sameSite: "lax",
    // 同一面板凭证供 /board/ 与 /share/ 网页落地页使用；HMAC 仍绑定 token 与访问纪元。
    path: "/",
  });
  return Response.json({ ok: true });
}
