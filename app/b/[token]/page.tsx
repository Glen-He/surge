import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import {
  boardUnlockCookieName,
  findPublicShareBoard,
  incrementBoardView,
  shouldCountBoardView,
  verifyBoardUnlockProof,
} from "@/lib/share-boards";
import { ShareBoardPasswordGate } from "@/components/share-board-password-gate";
import { ShareBoardPublic } from "@/components/share-board-public";
import { getOptionalSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function InvalidBoard() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[#f5f5f7] px-6">
      <div className="w-full max-w-[400px] rounded-[20px] bg-white p-8 text-center shadow-[0_2px_14px_rgba(0,0,0,0.05)]">
        <h1 className="text-[17px] font-semibold">分享面板无效或已停用</h1>
        <p className="mt-2 text-[13px] leading-[1.55] text-[#6e6e73]">请联系分享者确认面板状态或获取新链接。</p>
      </div>
    </main>
  );
}

export default async function ShareBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const board = await findPublicShareBoard(token);
  if (!board) return <InvalidBoard />;
  const session = await getOptionalSession();
  const isOwner = session?.user.id === board.ownerId;

  if (board.passwordHash && !isOwner) {
    const proof = (await cookies()).get(boardUnlockCookieName(token))?.value;
    if (!verifyBoardUnlockProof(token, board.accessEpoch, proof)) {
      return (
        <ShareBoardPasswordGate token={token} title={board.title} />
      );
    }
  }

  const ip = clientIp(await headers());
  if (!isOwner && await shouldCountBoardView(token, ip).catch(() => false)) {
    after(async () => {
      await incrementBoardView(token).catch((error) => {
        logger.warn("board-view", "failed to record board view", error as Error);
      });
    });
  }
  return <ShareBoardPublic title={board.title} token={token} items={board.items} />;
}
