import { cookies, headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import {
  boardUnlockCookieName,
  boardUnlockProof,
  findPublicShareBoard,
} from "@/lib/share-boards";
import {
  checkUnlockRate,
  clearUnlockRate,
  verifySharePassword,
} from "@/lib/shares";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const board = await findPublicShareBoard(token);
  if (!board) return Response.json({ error: "面板无效或已停用" }, { status: 404 });
  if (!board.passwordHash) return Response.json({ ok: true });

  const rateKey = `board:${token}`;
  const ip = clientIp(await headers());
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
      ? board.usesPasscode
        ? body.password.toUpperCase()
        : body.password
      : "";
  if (
    !password ||
    password.length > 64 ||
    !(await verifySharePassword(password, board.passwordHash))
  ) {
    return Response.json(
      { error: board.usesPasscode ? "提取码不正确" : "密码不正确" },
      { status: 401 },
    );
  }
  await clearUnlockRate(rateKey, ip);
  const jar = await cookies();
  jar.set(boardUnlockCookieName(token), boardUnlockProof(token, board.accessEpoch), {
    httpOnly: true,
    secure: new URL(process.env.BETTER_AUTH_URL ?? req.url).protocol === "https:",
    sameSite: "lax",
    path: `/b/${token}`,
  });
  return Response.json({ ok: true });
}
