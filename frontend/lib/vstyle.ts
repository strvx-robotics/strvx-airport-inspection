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
export const BTN_DANGER =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-[#5c2420] bg-[#2a1311] font-medium text-[#e2685c] transition-colors hover:bg-[#341714] disabled:cursor-not-allowed disabled:opacity-40";

export const CHIP =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide font-mono";
export const CHIP_TONE = {
  green: "border-[#1f4631] bg-[#0f2419] text-[#56c98a]",
  gray: "border-[#343a3f] bg-[#1a1e21] text-[#c2c8cc]",
  black: "border-[#e7eaec] bg-[#e7eaec] text-[#0b0d0e]",
  blue: "border-[#1d3a5c] bg-[#0e1f33] text-[#69b0ff]",
  purple: "border-[#382a5c] bg-[#1b1430] text-[#b08cf5]",
  amber: "border-[#4a350f] bg-[#271b08] text-[#dca64f]",
  red: "border-[#5c2420] bg-[#2a1311] text-[#e2685c]",
} as const;
export type ChipTone = keyof typeof CHIP_TONE;

// severity / status dots
export const DOT: Record<string, string> = {
  low: "bg-[#6b7378]",
  medium: "bg-[#d9a441]",
  high: "bg-[#dca64f]",
  critical: "bg-[#e2685c]",
};

export const EYEBROW =
  "font-mono text-[11px] uppercase tracking-[0.16em] text-[#737a7f]";
export const H2 = "text-[18px] font-semibold text-[#e7eaec]";
export const MUTED = "text-[#737a7f]";
export const LINK = "font-mono text-[11px] text-[#69b0ff] hover:underline";

// metric-strip cell (use inside a `grid gap-px bg-[#262b2f] rounded-md overflow-hidden`)
export const METRIC_CELL = "bg-[#121517] px-4 py-3";
