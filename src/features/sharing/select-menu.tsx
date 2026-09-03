"use client";

import { useEffect, useId, useRef, useState } from "react";

export type SelectMenuOption<T extends string | number> = {
  value: T;
  label: string;
};

/**
 * 项目统一的单选下拉菜单：保持原生 select 的键盘语义，同时避免浏览器系统菜单破坏视觉一致性。
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
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openMenu(index = selectedIndex) {
    setActiveIndex(index);
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
        className={`flex h-[38px] w-full items-center justify-between rounded-[10px] border bg-white px-3 text-left text-[14px] text-[#1d1d1f] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-[#0071e3]" : "border-black/12 hover:border-black/20"
        }`}
      >
        <span>{selected?.label ?? ""}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`h-[14px] w-[14px] shrink-0 text-[#86868b] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={controlId}
          className="animate-fade-in absolute left-0 top-[calc(100%+6px)] z-40 w-full min-w-[150px] rounded-[12px] border border-black/8 bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.05)]"
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
                className={`flex h-[36px] w-full items-center justify-between rounded-[9px] px-2.5 text-left text-[14px] transition-colors ${
                  isSelected
                    ? "bg-[#eef6ff] font-medium text-[#0071e3]"
                    : isActive
                      ? "bg-[#f5f5f7] text-[#1d1d1f]"
                      : "text-[#1d1d1f]"
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
        </div>
      )}
    </div>
  );
}
