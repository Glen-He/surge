"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 安全操作 Modal：
 * - 桌面 520px / 手机自适应（同一套 DOM）
 * - focus trap：Tab 循环在弹窗内，关闭后焦点返回触发按钮
 * - Esc / 遮罩点击 / × 均走 requestClose：请求中（busy）忽略；
 *   存在未保存内容（dirty）时先确认“放弃本次修改？”
 */
export function Modal({
  open,
  onClose,
  title,
  busy = false,
  dirty = false,
  plainHeader = false,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** 有请求 / 自动验证正在执行时传 true，禁止关闭，避免状态混乱 */
  busy?: boolean;
  /** 存在关闭后会丢失的填写内容时传 true，关闭前先确认 */
  dirty?: boolean;
  /** 为 true 时标题下不显示分隔线 */
  plainHeader?: boolean;
  /** 宽内容（如 PDF 阅读器）使用的大号布局 */
  wide?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  // 键盘避让：手机软键盘弹出时 layout viewport 不缩小（iOS 行为），
  // fixed 弹窗会被键盘盖住。用 visualViewport 把容器约束到真实可见区，
  // 配合 items-center 让表单（含获取验证码按钮）始终居中于键盘上方。
  const [visibleRect, setVisibleRect] = useState<{
    top: number;
    height: number;
  } | null>(null);

  const stateRef = useRef({ busy, dirty, confirming, onClose });
  useEffect(() => {
    stateRef.current = { busy, dirty, confirming, onClose };
  }, [busy, dirty, confirming, onClose]);

  function closeNow() {
    setConfirming(false);
    stateRef.current.onClose();
  }

  // 同步 visualViewport（键盘弹出 / 地址栏收起都会改变可见区）。
  // 桌面上 top=0、height=视口高，与 inset-0 等价，无副作用。
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      setVisibleRect({ top: vv.offsetTop, height: vv.height });
      // 键盘动画期间可见区连续变化；动画结束后若焦点输入框仍被遮挡，
      // 滚动弹窗内部滚动容器兜底（block:nearest 可见时不产生滚动）
      const active = document.activeElement;
      if (active instanceof HTMLElement && rootRef.current?.contains(active)) {
        window.setTimeout(() => active.scrollIntoView({ block: "nearest" }), 350);
      }
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [open]);

  // 用户发起的关闭：busy 忽略；dirty 先确认
  function requestClose() {
    const s = stateRef.current;
    if (s.busy) return;
    if (s.confirming) {
      setConfirming(false);
      return;
    }
    if (s.dirty) {
      setConfirming(true);
      return;
    }
    closeNow();
  }

  // 焦点管理：trap + Esc + 关闭后恢复焦点
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );

    // 初始焦点落在非交互的弹窗容器：读屏与 Tab 焦点不会留在
    // 被遮住的背景页面，同时不会让关闭按钮或输入框在打开时默认高亮。
    const root = rootRef.current;
    root?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      const s = stateRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        if (s.busy) return;
        if (s.confirming) setConfirming(false);
        else if (s.dirty) setConfirming(true);
        else closeNow();
        return;
      }
      if (e.key === "Tab") {
        const list = focusables();
        const root = rootRef.current;
        if (list.length === 0) {
          e.preventDefault();
          root?.focus();
          return;
        }
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const inside = !!active && root?.contains(active);
        if (active === root || !inside) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  // Portal 到 body：弹窗常被嵌在带 transform 的卡片（hover 位移）内，
  // transform 祖先会把 fixed 定位基准劫持为该卡片，导致遮罩/弹窗错位。
  // 渲染到 body 下可脱离任何 transform/层叠上下文祖先。
  // SSR 安全：open 初始恒为 false（null），客户端交互后才挂载 portal。
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title != null ? titleId : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={
        visibleRect
          ? ({ top: `${visibleRect.top}px`, height: `${visibleRect.height}px` } as CSSProperties)
          : undefined
      }
    >
      <div
        className="security-modal-overlay animate-fade-in absolute inset-0"
        onClick={requestClose}
      />
      <div
        ref={rootRef}
        role="document"
        tabIndex={-1}
        className={`security-modal ${wide ? "security-modal-wide" : ""} animate-fade-up relative z-10 outline-none`}
      >
        <header
          className={`security-modal-header ${plainHeader ? "security-modal-header-plain" : ""}`}
        >
          <h2 id={titleId} className="security-modal-title">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="关闭"
            className="security-modal-close"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-[16px] w-[16px]"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="security-modal-body">
          {confirming ? (
            <div className="animate-step">
              <p className="text-[16px] font-semibold text-[#1d1d1f]">
                放弃本次修改？
              </p>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#6e6e73]">
                当前填写的内容不会保存。
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="btn-secondary"
                >
                  继续修改
                </button>
                <button
                  type="button"
                  onClick={closeNow}
                  className="btn-danger-outline"
                >
                  放弃
                </button>
              </div>
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
