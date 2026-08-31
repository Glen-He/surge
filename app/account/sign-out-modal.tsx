"use client";

import { Modal } from "@/components/modal";

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
    <Modal open={open} onClose={onClose} title="退出登录？" busy={loading} plainHeader>
      <p className="text-[14px] leading-[1.55] text-[#6e6e73]">
        退出后，你需要重新登录才能继续使用该账号。
      </p>
      <p className="mt-2 min-h-[1.25rem] text-[13px] leading-5 text-[#ff3b30]">
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
          className="btn-primary"
        >
          {loading ? "退出中…" : "退出登录"}
        </button>
      </div>
    </Modal>
  );
}
