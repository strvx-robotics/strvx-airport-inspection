"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Valanor dropdown — a styled, keyboard-accessible replacement for native
 * <select>. The menu renders in a portal (fixed-positioned off the trigger) so
 * it never gets clipped by a card's overflow-hidden. Closes on click-away,
 * scroll, resize, or Escape.
 */
export default function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  placeholder = "Select…",
  className,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const selected = options.find((o) => o.value === value);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = (v: T) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = options[active];
      if (o) choose(o.value);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${baseId}-opt-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-[#f6f8f9] px-3 text-[13px] text-[#181b1e] transition-colors",
          open ? "border-[#181b1e] ring-2 ring-[#181b1e]/15" : "border-[#d3d7da] hover:border-[#9aa1a6]",
          "focus:border-[#181b1e] focus:outline-none focus:ring-2 focus:ring-[#181b1e]/15",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-[#9aa1a6]")}>{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          aria-hidden
          className={cn("shrink-0 text-[#6b7176] transition-transform", open && "rotate-180")}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}
            className="z-[120] max-h-60 overflow-auto rounded-md border border-[#d3d7da] bg-white p-1 shadow-[0_10px_28px_rgba(11,13,14,0.14)]"
          >
            {options.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-1.5 text-[13px]",
                    i === active ? "bg-[#eef1f4] text-[#181b1e]" : "text-[#3f4448]",
                  )}
                >
                  <span className="truncate">
                    {o.label}
                    {o.hint && <span className="ml-1.5 text-[11px] text-[#9aa1a6]">{o.hint}</span>}
                  </span>
                  {isSel && <Check size={14} strokeWidth={2.5} aria-hidden className="shrink-0 text-[#181b1e]" />}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
