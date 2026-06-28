// Valanor "internal-ops workspace" style vocabulary — mirrors verbatim the dark
// palette in strvx-robotics-product/frontend/src/features/logs/LogsView.tsx so
// these screens match the product exactly. Hex is intentionally literal.

export const PAGE = "bg-[#0b0d0e] text-[#e7eaec]";
export const CARD = "border border-[#262b2f] bg-[#121517]";
export const BAR = "border-b border-[#262b2f] bg-[#16191c]";
export const INPUT =
  "rounded-md border border-[#343a3f] bg-[#0f1214] text-[12px] text-[#e7eaec] placeholder:text-[#5b6166] focus:border-[#5b6166] focus:outline-none";
export const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#343a3f] bg-[#121517] font-medium text-[#9aa1a6] transition-colors hover:bg-[#1b2024] hover:text-[#e7eaec] disabled:cursor-not-allowed disabled:opacity-40";
// Primary = inverted, matching LogsView's active filter tab.
export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#e7eaec] font-medium text-[#0b0d0e] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40";
// Destructive action — signalled by the verb/icon + heavier weight, not red.
export const BTN_DANGER =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#5b6166] bg-[#16191c] font-semibold text-[#e7eaec] transition-colors hover:bg-[#1b2024] disabled:cursor-not-allowed disabled:opacity-40";

export const CHIP =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide font-mono";
// Monochrome chip scale — meaning by emphasis (fill / outline / weight), never hue.
// Keys are kept verbatim so every ui.ts tone assignment recolors here centrally:
//   green  → S1 idle  (settled: approved/closed/no-issues — recede)
//   gray   → S2 normal (neutral/medium/draft)
//   blue   → S3 active, solid edge  (in-flight: sent/in_progress)
//   purple → S3 active, dashed edge (needs human: manual_review/repaired)
//   amber  → S3 active, bright outline (loud: pending/high/needs_review)
//   black / red → S4 alert, solid white fill (loudest: critical/rejected/failed)
export const CHIP_TONE = {
  green: "border-[#343a3f] bg-[#121517] text-[#868d92]",
  gray: "border-[#343a3f] bg-[#1a1e21] text-[#c2c8cc]",
  black: "border-[#e7eaec] bg-[#e7eaec] text-[#0b0d0e]",
  blue: "border-[#5b6166] bg-[#16191c] text-[#c2c8cc]",
  purple: "border-dashed border-[#5b6166] bg-[#1a1e21] text-[#e7eaec]",
  amber: "border-[#9aa1a6] bg-[#1a1e21] text-[#e7eaec]",
  red: "border-[#e7eaec] bg-[#e7eaec] text-[#0b0d0e]",
} as const;
export type ChipTone = keyof typeof CHIP_TONE;

// severity / status dots — monotonic brightness ramp; critical adds weight (ring),
// not a brighter shade, since high+critical both sit near white.
export const DOT: Record<string, string> = {
  low: "bg-[#6b7378]",
  medium: "bg-[#9aa1a6]",
  high: "bg-[#c2c8cc]",
  critical: "bg-[#e7eaec] ring-2 ring-[#e7eaec]/30",
};

export const EYEBROW =
  "font-mono text-[11px] uppercase tracking-[0.16em] text-[#737a7f]";
export const H2 = "text-[18px] font-semibold text-[#e7eaec]";
export const MUTED = "text-[#737a7f]";
// Monochrome link affordance — brighten on hover (no blue, no underline noise on
// the icon nav links these are used for).
export const LINK =
  "font-mono text-[11px] text-[#9aa1a6] transition-colors hover:text-[#e7eaec]";

// metric-strip cell (use inside a `grid gap-px bg-[#262b2f] rounded-md overflow-hidden`)
export const METRIC_CELL = "bg-[#121517] px-4 py-3";
