import type { BBox } from "@/lib/types";

// Drone-photo evidence panel. Shows the REAL captured image when `src` is given
// (uploaded photos persisted to object storage); otherwise a self-contained CSS
// stand-in (the seed demo ships no real imagery). The detection box overlays either.
//
// The box is in PERCENT of the original image, so the real image must be shown at
// its natural aspect ratio (block w-full, NOT object-cover into a fixed height —
// cover crops the photo and the box would no longer sit on the defect).
export default function RunwayImage({
  bbox,
  label,
  src,
  heightClass = "h-64",
}: {
  bbox?: BBox;
  label?: string;
  src?: string;
  heightClass?: string;
}) {
  const real = Boolean(src);
  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border border-[#dbdfe3] ${real ? "" : heightClass}`}
      style={
        real
          ? undefined
          : { background: "repeating-linear-gradient(180deg, #eef1f4 0 38px, #e4e8ec 38px 40px)" }
      }
    >
      {real ? (
        // Natural aspect → the box's percent coords map 1:1 to the displayed pixels.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label ?? "Inspection capture"} className="block w-full" />
      ) : (
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2"
          style={{
            background: "repeating-linear-gradient(#3f4448 0 26px, transparent 26px 52px)",
            opacity: 0.7,
          }}
        />
      )}
      {bbox && (
        <div
          className="absolute border-2 border-[#181b1e] shadow-[0_0_0_9999px_rgba(11,13,14,0.55)]"
          style={{
            left: `${bbox.x}%`,
            top: `${bbox.y}%`,
            width: `${bbox.w}%`,
            height: `${bbox.h}%`,
          }}
        >
          {label && (
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#181b1e] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#e9ecef]">
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
