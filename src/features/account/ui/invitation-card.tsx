"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CardHead } from "@/shared/ui/card-head";
import { CopyIconButton } from "@/shared/ui/copy-feedback-button";
import { inviteLinkFragment } from "@/features/auth/invite-link";
import type { InviteSummary } from "@/features/auth/registration-invites";

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

const ICON_INFO = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="h-[15px] w-[15px]"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" strokeLinecap="round" />
    <circle cx="12" cy="7.8" r="0.4" fill="currentColor" />
  </svg>
);

export function InvitationCard({ isGuest }: { isGuest: boolean }) {
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [loaded, setLoaded] = useState(isGuest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isGuest) return;
    fetch("/api/account/invites")
      .then((response) => response.json())
      .then((data) => {
        setInvite(data.invite ?? null);
        setError(data.error ?? "");
      })
      .catch(() => setError("邀请码加载失败，请刷新后重试"))
      .finally(() => setLoaded(true));
  }, [isGuest]);

  async function mutate(method: "POST" | "PATCH") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/invites", { method });
      const data = (await response.json().catch(() => null)) as
        | { invite?: InviteSummary; error?: string }
        | null;
      if (!response.ok || !data?.invite) {
        setError(data?.error ?? "邀请码生成失败，请重试");
        return;
      }
      setInvite(data.invite);
    } catch {
      setError("网络异常，邀请码未生成");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (busy || !invite || invite.disabledAt) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/invites", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "邀请码撤销失败，请重试");
        return;
      }
      setInvite({ ...invite, disabledAt: new Date().toISOString() });
    } catch {
      setError("网络异常，邀请码未撤销");
    } finally {
      setBusy(false);
    }
  }

  const active = !!invite && !invite.disabledAt;

  return (
    <section className="account-card">
      <CardHead
        icon={ICON_INVITE}
        title="邀请注册"
        desc="使用你的专属邀请码邀请其他用户加入"
        extra={
          !isGuest ? (
            <Link
              href="/account/invitations"
              aria-label="查看邀请详情"
              className="mt-[1px] shrink-0 text-[#86868b] transition-colors hover:text-[#0071e3]"
            >
              {ICON_INFO}
            </Link>
          ) : undefined
        }
      />
      <div className="card-main shifted max-h-[83px] overflow-y-auto">
        {isGuest ? (
          <p className="text-[15px] leading-[1.5] text-[#6e6e73]">
            游客模式不支持邀请用户，注册正式账号后可用
          </p>
        ) : !loaded ? (
          <p className="text-[15px] leading-[1.5] text-[#86868b]">加载中…</p>
        ) : active ? (
          <div>
            <div className="flex min-w-0 items-center">
              <code className="text-[17px] font-semibold tracking-[0.14em] text-[#1d1d1f]">
                {invite.code ?? "邀请码不可读取"}
              </code>
              {invite.code && (
                <CopyIconButton
                  key={invite.code}
                  text={() =>
                    `${window.location.origin}/#${inviteLinkFragment(invite.code!)}`
                  }
                  label="复制邀请链接"
                  copiedLabel="邀请链接已复制"
                  onCopyError={() => setError("复制失败，请稍后重试")}
                />
              )}
              <span className="ml-auto pl-3 text-right text-[12px] leading-none text-[#86868b]">
                {invite.useCount} 人已注册
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.45] text-[#6e6e73]">
              更换或撤销后旧值立即失效
            </p>
          </div>
        ) : invite ? (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[17px] font-semibold leading-[1.4] text-[#1d1d1f]">
                邀请码已撤销
              </p>
              <span className="shrink-0 text-right text-[12px] leading-none text-[#86868b]">
                {invite.useCount} 人已注册
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.45] text-[#6e6e73]">
              重新生成后旧邀请码仍保持失效
            </p>
          </div>
        ) : (
          <p className="text-[15px] leading-[1.5] text-[#6e6e73]">
            还没有邀请码，生成后可随时复制邀请链接
          </p>
        )}
        <p className="mt-3 min-h-[1.375rem] text-[13px] leading-[1.5] text-[#ff3b30]">
          {error || null}
        </p>
      </div>
      <div className="card-action-wrap">
        <div className="card-action gap-6">
          {active ? (
            <>
              <button
                type="button"
                onClick={() => void revoke()}
                disabled={busy}
                style={{ color: "#ff3b30" }}
                className="btn-action disabled:cursor-not-allowed disabled:opacity-40"
              >
                撤销
              </button>
              <button
                type="button"
                onClick={() => void mutate("PATCH")}
                disabled={busy}
                className="btn-action disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "处理中…" : "更换"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isGuest || busy}
              onClick={() => void mutate(invite ? "PATCH" : "POST")}
              className="btn-action disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "生成中…" : invite ? "重新生成" : "生成邀请码"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
