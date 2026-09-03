"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/shared/ui/modal/modal";
import type { AccountSessionSummary } from "@/features/account/account-sessions";
import { clearGuestClientState } from "@/features/auth/guest/guest-session-client";

type PendingAction =
  | { kind: "single"; sessionId: string; label: string }
  | { kind: "others"; count: number }
  | { kind: "current" };

const ICON_DESKTOP = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M8 20h8" />
  </svg>
);

const ICON_MOBILE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10 18.5h4" />
  </svg>
);

const ICON_CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-[14px] w-[14px]">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

function describeUserAgent(userAgent: string | null) {
  const ua = userAgent ?? "";
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Microsoft Edge"
    : /CriOS\//.test(ua)
      ? "Chrome"
      : /FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "未知浏览器";
  const system = /iPad/.test(ua)
    ? "iPadOS"
    : /iPhone/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "未知系统";

  return { label: `${browser} · ${system}`, mobile };
}

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDate(value: string) {
  return dateTime.format(new Date(value));
}

export function SessionsManager({
  initialSessions,
}: {
  initialSessions: AccountSessionSummary[];
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const otherCount = sessions.filter((session) => !session.current).length;

  async function confirmAction() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const endpoint =
        pending.kind === "current"
          ? "/api/auth/end-session"
          : pending.kind === "others"
            ? "/api/account/sessions/others"
            : `/api/account/sessions/${encodeURIComponent(pending.sessionId)}`;
      const response = await fetch(endpoint, {
        method: pending.kind === "current" ? "POST" : "DELETE",
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(data?.error ?? "操作失败，请重试");
        return;
      }

      if (pending.kind === "current") {
        clearGuestClientState();
        router.push("/");
        router.refresh();
        return;
      }
      if (pending.kind === "others") {
        setSessions((current) => current.filter((session) => session.current));
      } else {
        setSessions((current) =>
          current.filter((session) => session.id !== pending.sessionId),
        );
      }
      setPending(null);
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
    }
  }

  const modalTitle =
    pending?.kind === "current"
      ? "退出当前设备？"
      : pending?.kind === "others"
        ? "退出其他设备？"
        : "退出这台设备？";
  const modalDescription =
    pending?.kind === "current"
      ? "退出后，这台设备需要重新登录才能继续使用该账号。"
      : pending?.kind === "others"
        ? `将退出另外 ${pending.count} 个登录会话，当前设备保持登录。`
        : pending?.kind === "single"
          ? `${pending.label} 将需要重新登录，当前设备不受影响。`
          : "";

  return (
    <>
      <section className="rounded-[22px] bg-white px-8 py-8 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.05)] md:px-10">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 className="text-[19px] font-semibold text-[#1d1d1f]">
              活跃会话
            </h2>
            <p className="mt-1.5 text-[14px] leading-[1.5] text-[#6e6e73]">
              共 {sessions.length} 个会话；设备名称根据浏览器信息识别，可能存在少量偏差
            </p>
          </div>
          <button
            type="button"
            disabled={otherCount === 0 || busy}
            onClick={() => setPending({ kind: "others", count: otherCount })}
            className="btn-action-danger shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            退出其他设备
            {ICON_CHEVRON}
          </button>
        </div>

        <p className="mt-4 min-h-[1.375rem] text-[13px] leading-[1.5] text-[#ff3b30]">
          {error || null}
        </p>

        <div className="mt-2 grid gap-4">
          {sessions.map((session) => {
            const device = describeUserAgent(session.userAgent);
            return (
              <article
                key={session.id}
                className="flex flex-col gap-5 rounded-[16px] bg-[#f7f7f9] px-5 py-5 sm:flex-row sm:items-center"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                  {device.mobile ? ICON_MOBILE : ICON_DESKTOP}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[16px] font-semibold text-[#1d1d1f]">
                      {device.label}
                    </h3>
                    {session.current && <span className="badge-success">当前设备</span>}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-[#6e6e73]">
                    最近活动 {formatDate(session.updatedAt)}
                    {session.ipAddress ? ` · IP ${session.ipAddress}` : ""}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-[1.5] text-[#86868b]">
                    登录于 {formatDate(session.createdAt)} · 有效至 {formatDate(session.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setPending(
                      session.current
                        ? { kind: "current" }
                        : {
                            kind: "single",
                            sessionId: session.id,
                            label: device.label,
                          },
                    )
                  }
                  className="btn-action-danger self-end disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
                >
                  退出
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <Modal
        open={pending !== null}
        onClose={() => {
          if (busy) return;
          setPending(null);
          setError("");
        }}
        title={modalTitle}
        busy={busy}
        plainHeader
      >
        <p className="text-[14px] leading-[1.55] text-[#6e6e73]">
          {modalDescription}
        </p>
        <p className="mt-2 min-h-[1.25rem] text-[13px] leading-5 text-[#ff3b30]">
          {error || null}
        </p>
        <div className="modal-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPending(null);
              setError("");
            }}
            className="btn-secondary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmAction()}
            className="btn-danger"
          >
            {busy ? "退出中…" : "确认退出"}
          </button>
        </div>
      </Modal>
    </>
  );
}
