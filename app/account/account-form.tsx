"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { CardHead } from "@/components/card-head";
import { EmailChangeModal } from "./email-change-modal";
import { PasswordChangeModal } from "./password-change-modal";
import { SignOutModal } from "./sign-out-modal";
import { DeleteAccountModal } from "./delete-account-modal";

const ICON_USER = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
  </svg>
);

const ICON_MAIL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

const ICON_DEVICE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[19px] w-[19px]">
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M8 20h8" />
  </svg>
);

const ICON_CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-[14px] w-[14px]">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export function AccountForm({
  email,
  deletionRequestedAt,
}: {
  email: string;
  deletionRequestedAt: string | null;
}) {
  const router = useRouter();
  const [openEmail, setOpenEmail] = useState(false);
  const [openPassword, setOpenPassword] = useState(false);
  const [openSignOut, setOpenSignOut] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);

  // 冷却期截止日期 = 申请时间 + 15 天
  const deletionLabel = (() => {
    if (!deletionRequestedAt) return null;
    const d = new Date(new Date(deletionRequestedAt).getTime() + 15 * 86400000);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  })();

  async function handleCancelDeletion() {
    await fetch("/api/account/deletion/cancel", { method: "POST" });
    router.refresh();
  }

  async function handleSignOut() {
    if (signOutLoading) return;
    setSignOutLoading(true);
    try {
      // 统一走自建 end-session：访客账号会被销毁沙箱，真实用户注销会话
      await fetch("/api/auth/end-session", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setSignOutLoading(false);
    }
  }

  return (
    <>
      <div className="account-grid">
        {/* ── 账号信息 ── */}
        <section className="account-card">
          <CardHead icon={ICON_USER} title="账号信息" desc="当前登录账号" />
          <div className="card-main flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#1d1d1f] text-[22px] font-semibold text-white">
              {email.slice(0, 1).toUpperCase()}
            </div>
            <p className="break-email min-w-0 text-[17px] font-semibold leading-[1.4] text-[#1d1d1f]">
              {email}
            </p>
          </div>
          <div className="card-action-wrap">
            <p className="mt-4 min-h-[1.375rem] text-right text-[13px] leading-[1.5] text-[#ff3b30]">
              {deletionRequestedAt
                ? `已申请删除，${deletionLabel} 前可取消。`
                : null}
            </p>
            <div className="card-action">
              {deletionRequestedAt ? (
                <button
                  type="button"
                  onClick={() => void handleCancelDeletion()}
                  className="btn-action"
                >
                  取消删除
                  {ICON_CHEVRON}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenDelete(true)}
                  className="btn-action-danger"
                >
                  删除账号
                  {ICON_CHEVRON}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ── 登录邮箱 ── */}
        <section className="account-card">
          <CardHead
            icon={ICON_MAIL}
            title="登录邮箱"
            desc="用于登录、身份验证和接收安全通知"
          />
          <div className="card-main shifted">
            <p className="break-email text-[17px] font-semibold leading-[1.4] text-[#1d1d1f]">
              {email}
            </p>
            <span className="badge-success mt-2">已验证</span>
          </div>
          <div className="card-action-wrap">
            <div className="card-action">
              <button
                type="button"
                onClick={() => setOpenEmail(true)}
                className="btn-action"
              >
                修改邮箱
                {ICON_CHEVRON}
              </button>
            </div>
          </div>
        </section>

        {/* ── 登录密码 ── */}
        <section className="account-card">
          <CardHead
            icon={ICON_LOCK}
            title="登录密码"
            desc="保护你的账号登录安全"
          />
          <div className="card-main shifted">
            <p className="text-[17px] tracking-[0.22em] text-[#1d1d1f]">
              ••••••••••••
            </p>
            <p className="mt-1.5 text-[13px] leading-[1.45] text-[#6e6e73]">
              支持当前密码或邮箱验证码验证
            </p>
          </div>
          <div className="card-action-wrap">
            <div className="card-action">
              <button
                type="button"
                onClick={() => setOpenPassword(true)}
                className="btn-action"
              >
                修改密码
                {ICON_CHEVRON}
              </button>
            </div>
          </div>
        </section>

        {/* ── 登录会话 ── */}
        <section className="account-card">
          <CardHead
            icon={ICON_DEVICE}
            title="登录会话"
            desc="管理当前账号的登录状态"
          />
          <div className="card-main shifted">
            <p className="text-[17px] font-semibold leading-[1.4] text-[#1d1d1f]">
              当前设备
            </p>
            <span className="badge-success mt-2">活跃</span>
          </div>
          <div className="card-action-wrap">
            <div className="card-action">
              <button
                type="button"
                onClick={() => setOpenSignOut(true)}
                className="btn-danger-outline"
              >
                退出登录
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* 弹窗：所有敏感操作在当前页面完成 */}
      <EmailChangeModal
        open={openEmail}
        onClose={() => setOpenEmail(false)}
        currentEmail={email}
      />
      <PasswordChangeModal
        open={openPassword}
        onClose={() => setOpenPassword(false)}
        currentEmail={email}
      />
      <SignOutModal
        open={openSignOut}
        onClose={() => setOpenSignOut(false)}
        onConfirm={handleSignOut}
        loading={signOutLoading}
      />
      <DeleteAccountModal
        open={openDelete}
        onClose={() => setOpenDelete(false)}
        onScheduled={() => {
          setOpenDelete(false);
          router.refresh();
        }}
      />
    </>
  );
}
