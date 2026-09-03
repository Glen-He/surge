import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveAccountSessions } from "@/features/account/account-sessions";
import { isGuestEmail } from "@/features/auth/guest/guest-identity";
import { requireSession } from "@/features/session/session";
import { SessionsManager } from "@/features/account/ui/sessions-manager";

const ICON_BACK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-[15px] w-[15px]"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export default async function AccountSessionsPage() {
  const session = await requireSession();
  if (isGuestEmail(session.user.email)) redirect("/account");

  const sessions = await listActiveAccountSessions(
    session.user.id,
    session.session.id,
  );

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      <div className="account-shell">
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              登录设备
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              查看并管理当前账号的活跃登录会话
            </p>
          </div>
          <Link href="/account" className="btn-light shrink-0">
            {ICON_BACK}
            返回
          </Link>
        </div>

        <SessionsManager initialSessions={sessions} />
      </div>
    </main>
  );
}
