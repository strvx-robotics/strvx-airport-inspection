// Small, dependency-free formatting helpers for the dashboard. Pure — `rel`
// takes an injectable `now` so it stays deterministic under test.

/** Format an ISO timestamp in a timezone. Falls back to UTC on a bad tz/date. */
export function fmtInTz(
  iso: string | undefined,
  tz: string | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", ...opts }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(d);
  }
}

/** Compact relative time: "just now", "3h ago", "in 2d". */
export function rel(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = t - now;
  const a = Math.abs(diff);
  if (a < 45_000) return "just now";
  const [val, unit] =
    a < 3_600_000 ? [Math.round(a / 60_000), "m"] :
    a < 86_400_000 ? [Math.round(a / 3_600_000), "h"] :
    a < 2_592_000_000 ? [Math.round(a / 86_400_000), "d"] :
    [Math.round(a / 2_592_000_000), "mo"];
  return diff < 0 ? `${val}${unit} ago` : `in ${val}${unit}`;
}

// ── Self-check (ponytail: run with `npx tsx lib/format.ts`) ───────────────────

function selfCheck(): void {
  const now = Date.parse("2026-06-27T12:00:00.000Z");
  console.assert(rel("2026-06-27T12:00:00.000Z", now) === "just now", "now");
  console.assert(rel("2026-06-27T09:00:00.000Z", now) === "3h ago", "3h ago");
  console.assert(rel("2026-06-25T12:00:00.000Z", now) === "2d ago", "2d ago");
  console.assert(rel("2026-06-27T14:00:00.000Z", now) === "in 2h", "in 2h");
  console.assert(rel(undefined, now) === "—", "undefined");
  // tz formatting is stable and never throws on a bad zone.
  const d = fmtInTz("2026-06-22T06:00:00.000Z", "not/a/zone", { hour: "2-digit" });
  console.assert(typeof d === "string" && d !== "—", "bad tz falls back");
  console.log("format self-check passed");
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.replace(/\\/g, "/").endsWith("lib/format.ts")
) {
  selfCheck();
}
