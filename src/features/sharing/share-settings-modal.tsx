"use client";

import { useState } from "react";
import { Modal } from "@/shared/ui/modal/modal";
import { SelectMenu } from "@/shared/ui/select-menu";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { SharePasscodeControl } from "@/features/sharing/share-passcode-control";
import {
  SHARE_EXPIRY_OPTIONS,
  nearestShareExpiryDays,
} from "@/features/sharing/share-expiry";
import type { ShareExpiryDays } from "@/features/sharing/share-expiry";

/**
 * 单条分享链接的设置弹窗（与「面板设置」同构）：
 * 有效期档位 + 访问保护 + 访问状态（暂停分享），灰底卡内提供「更换链接」。
 *
 * 只有用户真正改过的字段才会提交，避免"只改暂停态"顺带把到期时间重新计时；
 * 更换链接成功后把新 token 回传父组件，让复制按钮立即用上新链接。
 */
export function ShareSettingsModal({
  open,
  onClose,
  share,
  onTokenRotated,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  share: {
    id: string;
    expiresAt: string | null;
    passcode: string | null;
    disabled: boolean;
  };
  onTokenRotated: (token: string) => void;
  onSaved: () => void;
}) {
  const initialExpiry: ShareExpiryDays = nearestShareExpiryDays(
    share.expiresAt ? new Date(share.expiresAt) : null,
  );
  const [expiryDays, setExpiryDays] = useState<ShareExpiryDays>(initialExpiry);
  const [passwordProtected, setPasswordProtected] = useState(share.passcode !== null);
  const [regeneratePassword, setRegeneratePassword] = useState(false);
  const [disabled, setDisabled] = useState(share.disabled);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);

  // 打开时的快照：只有真正改过的字段才提交
  const expiryDaysOnOpen = initialExpiry;
  const passwordProtectedOnOpen = share.passcode !== null;
  const disabledOnOpen = share.disabled;

  const dirty =
    expiryDays !== expiryDaysOnOpen ||
    passwordProtected !== passwordProtectedOnOpen ||
    regeneratePassword ||
    disabled !== disabledOnOpen;

  async function rotateToken() {
    if (rotating) return;
    setRotating(true);
    setError("");
    try {
      const response = await fetch(`/api/shares/${share.id}/rotate-token`, {
        method: "POST",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "更换链接失败，请重试");
        return;
      }
      if (typeof data?.token === "string") onTokenRotated(data.token);
      onSaved();
    } finally {
      setRotating(false);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = {};
    if (expiryDays !== expiryDaysOnOpen) body.expiresInDays = expiryDays;
    if (!passwordProtected) body.password = null;
    else if (!share.passcode || regeneratePassword) body.regeneratePassword = true;
    if (disabled !== disabledOnOpen) body.disabled = disabled;
    try {
      const response = await fetch(`/api/shares/${share.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "保存失败，请重试");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || rotating;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="分享设置"
      plainHeader
      busy={busy}
      dirty={dirty}
    >
      {/* 3 个方框：上行「有效期」占满整行，下行「访问保护 + 访问状态」并排（≥640px）；
          手机端单列宽度放不下「文字 + 开关」的组合框，故退化为一列堆叠。间距口径与面板设置一致 */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className="mb-2 block type-label">有效期</span>
          <SelectMenu
            id="share-expiry"
            value={expiryDays}
            onChange={(value) => {
              setExpiryDays(value);
              setError("");
            }}
            disabled={busy}
            options={SHARE_EXPIRY_OPTIONS}
          />
        </div>
        <SharePasscodeControl
          enabled={passwordProtected}
          onChange={(enabled) => {
            setPasswordProtected(enabled);
            setRegeneratePassword(enabled && !share.passcode);
            setError("");
          }}
          disabled={busy}
        />
        <div>
          <span className="mb-2 block type-label">访问状态</span>
          {/* 方框本身不是开关：只有右侧小开关（含四周 6px 余量）可点、是小手，
              行内文字与空白保持默认箭头且点击无效。与「访问保护」「暂停公开访问」同一形态 */}
          <div className="flex h-[40px] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-control)] bg-[var(--surface)] px-3">
            <span className="min-w-0 truncate type-input text-[var(--text-primary)]">
              {disabled ? "已暂停" : "正常分享中"}
            </span>
            <ToggleSwitch
              checked={disabled}
              disabled={busy}
              label={disabled ? "已暂停" : "正常分享中"}
              onChange={(next) => {
                setDisabled(next);
                setError("");
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[12px] bg-[var(--surface-sunken)] p-3">
        <p className="type-caption text-[var(--text-secondary)]">
          更换链接后，旧链接立即失效，有效期、提取码与暂停状态保持不变。
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={rotateToken}
            disabled={busy}
            className="type-control-sm text-[var(--accent-text)] disabled:opacity-40"
          >
            {rotating ? "更换中…" : "更换链接"}
          </button>
        </div>
      </div>

      <p className="mt-2 h-[var(--line-height-caption)] type-caption text-[var(--danger-text)]">
        {error}
      </p>
      <div className="mt-4 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="btn-secondary">
          取消
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? "保存中…" : "保存设置"}
        </button>
      </div>
    </Modal>
  );
}
