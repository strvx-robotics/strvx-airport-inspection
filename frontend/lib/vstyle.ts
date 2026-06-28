// Valanor instrument-console style vocabulary. The workspace is an off-white
// panel ladder (paper #fbfcfd lifted over a recessed #e9ecef field) framed by
// hairline rules — never pure white, never a soft SaaS card. Hex is intentionally
// literal so every tone decision lives in one place.

export const PAGE = "bg-[#e9ecef] text-[#181b1e]";
export const CARD = "border border-[#dbdfe3] bg-[#fbfcfd]";
export const BAR = "border-b border-[#dbdfe3] bg-[#eef1f4]";
export const INPUT =
  "rounded-md border border-[#c7cdd2] bg-[#f3f5f7] text-[12px] text-[#181b1e] placeholder:text-[#9aa1a6] focus:border-[#888f95] focus:outline-none";
export const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#c7cdd2] bg-[#fbfcfd] font-medium text-[#5b6166] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e] disabled:cursor-not-allowed disabled:opacity-40";
// Primary = solid ink. Hover lifts the slate a notch (never to white, which would
// strand the light label) so the affordance stays legible.
export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#181b1e] font-medium text-[#eef1f4] transition-colors hover:bg-[#2b3035] disabled:cursor-not-allowed disabled:opacity-40";
// Destructive action — signalled by the verb/icon + heavier weight, not red.
export const BTN_DANGER =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#9aa1a6] bg-[#eef1f4] font-semibold text-[#181b1e] transition-colors hover:bg-[#e4e8ec] disabled:cursor-not-allowed disabled:opacity-40";

export const CHIP =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide font-mono";
// Monochrome chip scale — meaning by emphasis (fill / outline / weight), never hue.
// Keys are kept verbatim so every ui.ts tone assignment recolors here centrally:
//   green  → S1 idle  (settled: approved/closed/no-issues — recede)
//   gray   → S2 normal (neutral/medium/draft)
//   blue   → S3 active, solid edge  (in-flight: sent/in_progress)
//   purple → S3 active, dashed edge (needs human: manual_review/repaired)
//   amber  → S3 active, bright outline (loud: pending/high/needs_review)
//   black / red → S4 alert, solid ink fill (loudest: critical/rejected/failed)
export const CHIP_TONE = {
  green: "border-[#c7cdd2] bg-[#fbfcfd] text-[#6b7176]",
  gray: "border-[#c7cdd2] bg-[#e4e8ec] text-[#3f4448]",
  black: "border-[#181b1e] bg-[#181b1e] text-[#eef1f4]",
  blue: "border-[#9aa1a6] bg-[#eef1f4] text-[#3f4448]",
  purple: "border-dashed border-[#9aa1a6] bg-[#e4e8ec] text-[#181b1e]",
  amber: "border-[#5b6166] bg-[#e4e8ec] text-[#181b1e]",
  red: "border-[#181b1e] bg-[#181b1e] text-[#eef1f4]",
} as const;
export type ChipTone = keyof typeof CHIP_TONE;

// severity / status dots — monotonic brightness ramp; critical adds weight (ring),
// not a brighter shade, since high+critical both sit near ink.
export const DOT: Record<string, string> = {
  low: "bg-[#b4b9bd]",
  medium: "bg-[#5b6166]",
  high: "bg-[#3f4448]",
  critical: "bg-[#181b1e] ring-2 ring-[#181b1e]/30",
};

export const EYEBROW =
  "font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b7176]";
export const H2 = "text-[18px] font-semibold text-[#181b1e]";
export const MUTED = "text-[#6b7176]";
// Monochrome link affordance — brighten on hover (no blue, no underline noise on
// the icon nav links these are used for).
export const LINK =
  "font-mono text-[11px] text-[#5b6166] transition-colors hover:text-[#181b1e]";

// metric-strip cell (use inside a `grid gap-px bg-[#dbdfe3] rounded-md overflow-hidden`)
export const METRIC_CELL = "bg-[#fbfcfd] px-4 py-3";
