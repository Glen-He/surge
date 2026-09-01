import Link from "next/link";
import { AdminConsole } from "./admin-console";
import { requireAdminSession } from "@/lib/admin";
import { getRegistrationPolicy } from "@/lib/registration-policy";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminSession();
  const policy = await getRegistrationPolicy();

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      <div className="account-shell">
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              管理员后台
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              管理平台注册策略与其他全局能力
            </p>
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
