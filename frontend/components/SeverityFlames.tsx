import { Flame } from "lucide-react";
import type { Severity } from "@/lib/types";

const FLAMES: Record<Severity, number> = { low: 2, medium: 3, high: 4, critical: 5 };
const HEAT: Record<Severity, string> = {
  low: "text-[#d99a2b]",
  medium: "text-[#d97f28]",
  high: "text-[#d85f22]",
  critical: "text-[#d23b1e]",
};

export function SeverityFlames({ severity }: { severity: Severity }) {
  const rating = FLAMES[severity];

  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`Severity ${rating}/5 · ${severity}`}
      aria-label={`Severity ${rating} of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = n <= rating;
        return (
          <Flame
            key={n}
            size={15}
            strokeWidth={2}
            aria-hidden
            className={lit ? HEAT[severity] : "text-[#d3d7da]"}
            fill={lit ? "currentColor" : "none"}
            style={lit ? { filter: "drop-shadow(0 0 2.5px currentColor)" } : undefined}
          />
        );
      })}
    </span>
  );
}
