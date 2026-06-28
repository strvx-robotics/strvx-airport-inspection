import type { ReactNode } from "react";
import { CHIP, CHIP_TONE, type ChipTone } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

export type Tone = ChipTone;

export default function Badge({
  tone = "gray",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={cn(CHIP, CHIP_TONE[tone])}>{children}</span>;
}
