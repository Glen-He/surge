"use client";

import { useState } from "react";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { RegistrationPolicy } from "@/lib/registration-policy";

export function AdminConsole({
  initialPolicy,
}: {
  initialPolicy: RegistrationPolicy;
}) {
  const [policy, setPolicy] = useState(initialPolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function savePolicy(next: RegistrationPolicy) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/registration-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await response.json().catch(() => null)) as
        | (RegistrationPolicy & { error?: string })
        | null;
      if (!response.ok || !data) {
        setError(data?.error ?? "注册策略保存失败，请重试");
        return;
      }
      setPolicy({ enabled: data.enabled, inviteRequired: data.inviteRequired });
    } catch {
      setError("网络异常，注册策略未保存");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-card min-h-[260px]">
        <div className="card-head">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.01em]">
              注册策略
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6e6e73]">
              修改后立即作用于所有实例和注册入口
            </p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex min-h-[74px] items-center justify-between gap-5 rounded-[16px] bg-[#f7f7f9] px-5 py-4">
            <div>
              <p className="text-[14px] font-medium">允许用户注册</p>
              <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">
                关闭后已有用户仍可正常登录
              </p>
            </div>
            <ToggleSwitch
              label="允许用户注册"
              checked={policy.enabled}
              disabled={busy}
              onChange={(enabled) =>
                void savePolicy({
                  enabled,
                  inviteRequired: enabled && policy.inviteRequired,
                })
              }
            />
          </div>
          <div className="flex min-h-[74px] items-center justify-between gap-5 rounded-[16px] bg-[#f7f7f9] px-5 py-4">
            <div>
              <p className="text-[14px] font-medium">仅限邀请码注册</p>
              <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">
                关闭后邀请码仍可选填并记录归因
              </p>
            </div>
            <ToggleSwitch
              label="仅限邀请码注册"
              checked={policy.inviteRequired}
              disabled={busy || !policy.enabled}
              onChange={(inviteRequired) =>
                void savePolicy({ enabled: policy.enabled, inviteRequired })
              }
            />
          </div>
        </div>
        <p className="mt-3 min-h-[20px] text-[12px] leading-5 text-[#ff3b30]">
          {error}
        </p>
    </section>
  );
}
