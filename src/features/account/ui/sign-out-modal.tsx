"use client";

import { Modal } from "@/shared/ui/modal/modal";

export function SignOutModal({
  open,
  onClose,
  onConfirm,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  error?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="退出当前设备？" busy={loading} plainHeader>
      <p className="type-body text-[var(--text-secondary)]">
        退出后，这台设备需要重新登录才能继续使用该账号。
      </p>
      <p className="mt-2 min-h-[1.25rem] type-caption text-[var(--danger-text)]">
        {error}
      </p>
      <div className="modal-actions">
        <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">
          取消
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={loading}
          className="btn-danger"
        >
          {loading ? "退出中…" : "确认退出"}
        </button>
      </div>
    </Modal>
  );
}
