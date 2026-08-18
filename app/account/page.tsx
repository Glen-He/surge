import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { AccountForm } from "./account-form";
import { GuestSessionWatcher } from "@/components/guest-toasts";
import {
  expireGuestIfNeeded,
  getGuestExpiry,
  isGuestEmail,
} from "@/lib/guest-sandbox";
import {
  getDeletionRequestedAt,
  purgeExpiredDeletions,
} from "@/lib/account-deletion";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  // 先清理冷却期已过的账号，再读会话（过期账号直接回到登录）
  await purgeExpiredDeletions();

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/");
  }

  // 访客会话到期：销毁并回登录页（带「访客体验已结束」提示）
  if (await expireGuestIfNeeded(session)) {
    redirect("/?guestExpired=1");
  }

  const deletionRequestedAt = await getDeletionRequestedAt(session.user.id);

  // 访客：读沙箱到期时间（倒计时展示 + 守望器到期前提醒/到点退出）
  const guestExpiry = isGuestEmail(session.user.email)
    ? await getGuestExpiry(session.user.id)
    : null;

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      <div className="account-shell">
        {/* Header：标题 + 副标题 左侧，轻量返回 右侧 */}
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              账号与安全
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              管理你的登录信息、密码与账号安全设置
            </p>
          </div>
          <Link href="/home" className="btn-light shrink-0">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-[15px] w-[15px]"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            返回
          </Link>
        </div>

        <AccountForm
          email={session.user.email}
          deletionRequestedAt={
            deletionRequestedAt ? deletionRequestedAt.toISOString() : null
          }
          guestExpiresAt={guestExpiry ? guestExpiry.toISOString() : null}
        />
      </div>
      {guestExpiry && (
        <GuestSessionWatcher expiresAt={guestExpiry.toISOString()} />
      )}
    </main>
  );
}
