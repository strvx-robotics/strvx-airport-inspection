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
// Semantic status palette — the chrome stays monochrome, but status badges carry
// restrained, desaturated meaning-color (every ui.ts tone resolves here):
//   green  → settled / good      (approved, closed, no-issues, completed)
//   gray   → neutral             (draft, low, not-started)
//   blue   → in-flight / active  (sent, in-progress, processing)
//   purple → needs human         (manual-review, repaired)
//   amber  → attention / pending (pending, needs-review, medium/high severity)
//   red    → alert (loudest, solid fill) — critical, rejected, failed, likely-issue
export const CHIP_TONE = {
  green: "border-[#bcd6c4] bg-[#e4efe8] text-[#356b4c]",
  gray: "border-[#cdd2d7] bg-[#e9ecef] text-[#4f5358]",
  blue: "border-[#bcd0e4] bg-[#e0e9f3] text-[#2f5b85]",
  purple: "border-[#cabfe0] bg-[#e8e3f1] text-[#574a82]",
  amber: "border-[#e2cfa0] bg-[#f5ecd7] text-[#866018]",
  red: "border-[#a8392f] bg-[#b23b32] text-[#fbeae8]",
  black: "border-[#a8392f] bg-[#b23b32] text-[#fbeae8]",
} as const;
export type ChipTone = keyof typeof CHIP_TONE;

// severity dots — escalating ramp (neutral → ochre → orange → red); critical
// also carries a ring so it reads at a glance even out of context.
export const DOT: Record<string, string> = {
  low: "bg-[#9aa1a6]",
  medium: "bg-[#caa44e]",
  high: "bg-[#c8762f]",
  critical: "bg-[#b23b32] ring-2 ring-[#b23b32]/25",
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

// ── System up/down signal ─────────────────────────────────────────────────────
// API reachability, shown as a LOCALIZED lamp only (dot + word) on the header and
// status bar. The rails themselves stay flat slate — no whole-bar glow.
// up = green, down = red, init = neutral (not yet known).
export type SystemState = "init" | "up" | "down";
export const systemState = (online: boolean | undefined): SystemState =>
  online === undefined ? "init" : online ? "up" : "down";
export const SYSTEM_DOT: Record<SystemState, string> = {
  init: "bg-[#5b6166]",
  up: "bg-[#44b07f]",
  down: "bg-[#d05a52]",
};
export const SYSTEM_TEXT: Record<SystemState, string> = {
  init: "text-[#888f95]",
  up: "text-[#7fd0ab]",
  down: "text-[#e89a92]",
};
