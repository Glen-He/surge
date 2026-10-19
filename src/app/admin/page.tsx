import Link from "next/link";
import { AdminConsole } from "@/features/administration/ui/admin-console";
import { requireAdminSession } from "@/features/administration/admin";
import { getRegistrationPolicy } from "@/features/auth/registration-policy";

export default async function AdminPage() {
  await requireAdminSession();
  const policy = await getRegistrationPolicy();

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--text-primary)] antialiased">
      <div className="account-shell">
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="type-page-title tracking-[-0.02em] text-[var(--text-primary)]">
              管理后台
            </h1>
          </div>
          <Link href="/account" className="btn-light shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            返回
          </Link>
        </div>

        <AdminConsole initialPolicy={policy} />
      </div>
    </main>
  );
}
