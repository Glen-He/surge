import Link from "next/link";
import { redirect } from "next/navigation";
import { CardHead } from "@/shared/ui/card-head";
import { isGuestEmail } from "@/features/auth/guest/guest-sandbox";
import { getRegistrationInvite } from "@/features/auth/registration-invites";
import { requireSession } from "@/features/auth/session";

export const dynamic = "force-dynamic";

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

const ICON_INVITE = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="h-[19px] w-[19px]"
  >
    <path d="M5 8h14v11H5z" />
    <path d="M4 8h16M12 8v11M7.5 8C5 6 6.5 3.5 8.5 4.2 10 4.7 11 6.2 12 8M16.5 8C19 6 17.5 3.5 15.5 4.2 14 4.7 13 6.2 12 8" />
  </svg>
);

const ICON_REWARD = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="h-[19px] w-[19px]"
  >
    <path d="M5 8h14v12H5zM4 8h16M12 8v12" />
    <path d="M7.5 8C5 6 6.5 3.5 8.5 4.2 10 4.7 11 6.2 12 8M16.5 8C19 6 17.5 3.5 15.5 4.2 14 4.7 13 6.2 12 8" />
  </svg>
);

export default async function InvitationDetailsPage() {
  const session = await requireSession();
  if (isGuestEmail(session.user.email)) redirect("/account");

  const invite = await getRegistrationInvite(session.user.id);
  const status = !invite
    ? "尚未生成"
    : invite.disabledAt
      ? "已撤销"
      : "正常使用";

  return (
    <main className="min-h-svh bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      <div className="account-shell">
        <div className="mb-[42px] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
              邀请详情
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-[#6e6e73]">
              查看邀请码状态、邀请人数与后续奖励规则
            </p>
          </div>
          <Link href="/account" className="btn-light shrink-0">
            {ICON_BACK}
            返回
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="account-card min-h-[260px]">
            <CardHead
              icon={ICON_INVITE}
              title="邀请状态"
              desc="当前邀请码及累计注册情况"
            />
            <div className="mt-9 grid grid-cols-2 gap-4">
              <div className="rounded-[16px] bg-[#f7f7f9] px-5 py-4">
                <p className="text-[12px] leading-[1.4] text-[#86868b]">
                  当前状态
                </p>
                <p className="mt-1.5 text-[17px] font-semibold text-[#1d1d1f]">
                  {status}
                </p>
              </div>
              <div className="rounded-[16px] bg-[#f7f7f9] px-5 py-4">
                <p className="text-[12px] leading-[1.4] text-[#86868b]">
                  已注册人数
                </p>
                <p className="mt-1.5 text-[17px] font-semibold text-[#1d1d1f]">
                  {invite?.useCount ?? 0} 人
                </p>
              </div>
            </div>
            <p className="mt-5 text-[13px] leading-[1.6] text-[#6e6e73]">
              邀请码的生成、更换、撤销和复制仍在“账号与安全”页面完成。
            </p>
          </section>

          <section className="account-card min-h-[260px]">
            <CardHead
              icon={ICON_REWARD}
              title="奖励与规则"
              desc="后续邀请奖励和达成条件将在这里展示"
            />
            <div className="mt-9 rounded-[16px] bg-[#f7f7f9] px-5 py-5">
              <p className="text-[17px] font-semibold text-[#1d1d1f]">
                暂未开放邀请奖励
              </p>
              <p className="mt-2 text-[13px] leading-[1.6] text-[#6e6e73]">
                当前邀请人数会持续累计，未来启用奖励机制时无需重新生成邀请码。
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
