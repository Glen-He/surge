import Link from "next/link";
import { AccountForm } from "./account-form";
import { GuestSessionWatcher } from "@/components/guest-toasts";
import { hasAdminRole } from "@/lib/admin";
import { getGuestExpiry, isGuestEmail } from "@/lib/guest-sandbox";
import { requireSession } from "@/lib/session";
import { getDeletionRequestedAt } from "@/lib/account-deletion";
import { listActiveAccountSessions } from "@/lib/account-sessions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  // 未登录 → 登录页；游客沙箱到期 → 销毁并回登录页
  const session = await requireSession();
  const guest = isGuestEmail(session.user.email);
  const [deletionRequestedAt, guestExpiry, activeSessions] = await Promise.all([
    getDeletionRequestedAt(session.user.id),
    guest ? getGuestExpiry(session.user.id) : Promise.resolve(null),
    guest
      ? Promise.resolve([])
      : listActiveAccountSessions(session.user.id, session.session.id),
  ]);

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
          <div className="flex shrink-0 items-center gap-2.5">
            {hasAdminRole(session.user) && (
              <Link href="/admin" className="btn-light">
                管理员后台
              </Link>
            )}
            <Link href="/home" className="btn-light">
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
        </div>

        <AccountForm
          email={session.user.email}
          deletionRequestedAt={
            deletionRequestedAt ? deletionRequestedAt.toISOString() : null
          }
          guestExpiresAt={guestExpiry ? guestExpiry.toISOString() : null}
          activeSessionCount={activeSessions.length}
        />
      </div>
      {guestExpiry && (
        <GuestSessionWatcher expiresAt={guestExpiry.toISOString()} />
      )}
    </main>
  );
}
