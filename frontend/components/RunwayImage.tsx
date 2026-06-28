import type { BBox } from "@/lib/types";

// Detection box: percent-of-image coords, so it only aligns when it sits on an
// element sized exactly to the displayed image. Both render paths below ensure that.
function BoxOverlay({ bbox, label }: { bbox: BBox; label?: string }) {
  return (
    <div
      className="absolute border-2 border-[#181b1e] shadow-[0_0_0_9999px_rgba(11,13,14,0.55)]"
      style={{ left: `${bbox.x}%`, top: `${bbox.y}%`, width: `${bbox.w}%`, height: `${bbox.h}%` }}
    >
      {label && (
        <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#181b1e] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#e9ecef]">
          {label}
        </span>
      )}
    </div>
  );
}

// Drone-photo evidence panel. Shows the REAL captured image when `src` is given
// (uploaded photos persisted to object storage); otherwise a self-contained CSS
// stand-in (the seed demo ships no real imagery). The detection box overlays either.
//
//  fit="natural" (default) — image at natural aspect (block w-full); the panel's
//    height follows the photo. Used in lists/cards.
//  fit="contain" — letterbox the whole photo inside a fixed `heightClass` frame,
//    centered, never cropped. The box still tracks the image because the wrapper
//    shrink-wraps (w-fit) to the displayed picture.
export default function RunwayImage({
  bbox,
  label,
  src,
  heightClass = "h-64",
  fit = "natural",
}: {
  bbox?: BBox;
  label?: string;
  src?: string;
  heightClass?: string;
  fit?: "natural" | "contain";
}) {
  const real = Boolean(src);

  if (real && fit === "contain") {
    return (
      <figure
        className={`relative flex w-full items-center justify-center overflow-hidden rounded-md border border-[#dbdfe3] bg-[#0b0d0e] ${heightClass}`}
      >
        <div className="relative max-h-full w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label ?? "Inspection capture"}
            className="block max-h-full w-auto max-w-full object-contain"
          />
          {bbox && <BoxOverlay bbox={bbox} label={label} />}
        </div>
      </figure>
    );
  }

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
      {bbox && <BoxOverlay bbox={bbox} label={label} />}
    </div>
  );
}
