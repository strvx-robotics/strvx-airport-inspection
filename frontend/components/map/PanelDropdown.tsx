"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type DropdownOption = {
  value: string;
  label: string;
};

export function PanelDropdown({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-lg border border-[#bcc4ca] bg-[#fbfcfd] px-2.5 text-left font-mono text-[#181b1e] shadow-[0_1px_0_rgba(255,255,255,0.9)] transition-colors hover:border-[#9aa1a6] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f5b85]",
          compact ? "h-7 text-[11px] font-medium" : "h-9 text-[12px] font-semibold",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "Select"}</span>
        <ChevronDown
          size={14}
          strokeWidth={2.2}
          className={cn("shrink-0 text-[#5b6166] transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-[#2f3336]/40 bg-[#3f4448] p-1 shadow-[0_14px_36px_rgba(18,22,25,0.26)]">
          <div role="listbox" aria-label={label} className="max-h-52 overflow-y-auto">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left font-mono text-[12px] font-semibold tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white/70",
                    active
                      ? "bg-[#8d9295] text-[#fbfcfd]"
                      : "text-[#eef1f4] hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Check size={14} strokeWidth={2.3} className={cn("shrink-0", active ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
