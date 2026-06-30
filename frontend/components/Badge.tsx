import type { ReactNode } from "react";
import { CHIP, CHIP_TONE, type ChipTone } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

export type Tone = ChipTone;

export default function Badge({
  tone = "gray",
  compact = false,
  children,
}: {
  tone?: Tone;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        CHIP,
        CHIP_TONE[tone],
        compact && "px-1.5 py-0 text-[9px] tracking-[0.12em]",
      )}
    >
      {children}
    </span>
  );
}
