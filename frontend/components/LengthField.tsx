"use client";

import { cn } from "@/lib/cn";
import { formatLengthFt } from "@/lib/zoneAdmin";
import { EYEBROW, INPUT } from "@/lib/vstyle";

/**
 * Length input that auto-groups thousands with commas and shows a trailing "ft".
 * The user types digits only; `onChange` receives the normalized "8,001 ft" string
 * (or "" when empty), so callers can store/compare a single canonical format.
 */
export default function LengthField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const display = value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (
    <div className="space-y-1">
      <label className={EYEBROW}>{label}</label>
      <div className="relative">
        <input
          value={display}
          inputMode="numeric"
          onChange={(e) => onChange(formatLengthFt(e.target.value))}
          placeholder={placeholder}
          className={cn("h-8 w-full px-3 text-[12px]", display && "pr-8", INPUT)}
        />
        {display && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#6b7176]">
            ft
          </span>
        )}
      </div>
    </div>
  );
}
