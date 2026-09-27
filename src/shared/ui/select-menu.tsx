"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectMenuOption<T extends string | number> = {
  value: T;
  label: string;
};

const GAP = 6; // 面板与触发器的间距
const EDGE = 8; // 面板距视口边缘的最小间距
const MIN_WIDTH = 150; // 面板最小宽度（触发器更窄时也保证选项可读）

/** 面板定位：fixed 视口坐标；top / bottom 二选一，maxHeight 保证不越出视口 */
interface PanelPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * 项目统一的单选下拉菜单：保持原生 select 的键盘语义，同时避免浏览器系统菜单破坏视觉一致性。
 *
 * 面板必须 portal 到 body 用 fixed 定位，不能留在触发器原位：Modal body 的
 * overflow-y: auto（滚动容器裁切越出后代）、`.security-modal` 的 overflow: hidden
 * 和 `.animate-fade-up` 的 fill-mode: both（最终关键帧让弹窗常驻 transform，
 * 成为 fixed 的包含块、劫持坐标）都会破坏定位或直接裁掉面板。
 * 下方空间不足时自动向上弹出；两侧都不足时按可用空间给 maxHeight 走内部滚动。
 */
export function SelectMenu<T extends string | number>({
  id,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id?: string;
  value: T;
  options: Array<SelectMenuOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const controlId = id ?? `select-menu-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [pos, setPos] = useState<PanelPosition | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      // 面板已 portal 到 body，不在 rootRef 内，需要单独判断包含关系
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // 重新定位。面板首帧 visibility:hidden（见 JSX），在这里量尺寸是安全的
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panel.offsetHeight;
    const width = Math.max(MIN_WIDTH, rect.width);
    const spaceTop = rect.top - EDGE;
    const spaceBottom = window.innerHeight - rect.bottom - EDGE;
    // 优先向下；下方放不下且上方更宽裕时翻到上方（与日期弹层同一策略）
    const flipUp = panelHeight + GAP > spaceBottom && spaceTop > spaceBottom;
    const maxHeight = Math.max(0, (flipUp ? spaceTop : spaceBottom) - GAP);
    const left = Math.min(
      Math.max(EDGE, rect.left),
      Math.max(EDGE, window.innerWidth - width - EDGE),
    );
    setPos((prev) => {
      // 向上弹出时按 bottom 锚定：高度变化时面板始终贴着触发器向上生长
      const next: PanelPosition = flipUp
        ? { bottom: window.innerHeight - rect.top + GAP, left, width, maxHeight }
        : { top: rect.bottom + GAP, left, width, maxHeight };
      const unchanged =
        prev &&
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight;
      return unchanged ? prev : next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    // Modal body / 页面滚动（capture 捕获子元素滚动）与视口变化时跟随触发器
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  function openMenu(index = selectedIndex) {
    setActiveIndex(index);
    setPos(null); // 丢弃上次定位，量完尺寸再显示，避免闪现在旧位置
    setOpen(true);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function commit(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeMenu({ restoreFocus: true });
  }

  function moveActive(delta: number) {
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return options.length - 1;
      if (next >= options.length) return 0;
      return next;
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      // 阻止冒泡到 Modal 挂在 window 上的 Esc 监听，否则一次 Esc 会同时关掉下拉与整个弹窗
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openMenu(event.key === "Home" ? 0 : options.length - 1);
      else setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) commit(activeIndex);
      else openMenu();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const query = event.key.toLocaleLowerCase();
      const match = options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(query),
      );
      if (match >= 0) {
        event.preventDefault();
        if (open) setActiveIndex(match);
        else commit(match);
      }
    }
  }

  const selected = options[selectedIndex];

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex h-[40px] w-full items-center justify-between rounded-[var(--radius-md)] border bg-[var(--surface)] px-3 text-left type-input text-[var(--text-primary)] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-[var(--accent)]" : "border-[var(--border-control)] hover:border-[var(--border-hover)]"
        }`}
      >
        <span>{selected?.label ?? ""}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`h-[14px] w-[14px] shrink-0 text-[var(--icon-muted)] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={controlId}
            className="animate-fade-in z-[60] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.05)]"
            style={{ position: "fixed", ...(pos ?? { visibility: "hidden" }) }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <button
                  key={String(option.value)}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commit(index)}
                  className={`flex h-[36px] w-full items-center justify-between rounded-[var(--radius-sm)] px-2.5 text-left type-control transition-colors ${
                    isSelected
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]"
                      : isActive
                        ? "bg-[var(--control-hover)] text-[var(--text-primary)]"
                        : "text-[var(--text-primary)]"
                  }`}
                >
                  <span>{option.label}</span>
                  {isSelected && (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      aria-hidden="true"
                      className="h-[14px] w-[14px]"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
