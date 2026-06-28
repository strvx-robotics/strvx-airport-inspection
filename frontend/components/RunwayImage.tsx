import type { BBox } from "@/lib/types";

// Stand-in for a drone photo: an asphalt-textured panel with a dashed
// centerline and an optional detection box. Self-contained (no real images
// to ship in Phase 0) and it reads as "AI found this here".
export default function RunwayImage({
  bbox,
  label,
  heightClass = "h-64",
}: {
  bbox?: BBox;
  label?: string;
  heightClass?: string;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border border-[#262b2f] ${heightClass}`}
      style={{
        background:
          "repeating-linear-gradient(180deg, #15181b 0 38px, #1b1f22 38px 40px)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2"
        style={{
          background:
            "repeating-linear-gradient(#c2c8cc 0 26px, transparent 26px 52px)",
          opacity: 0.7,
        }}
      />
      {bbox && (
        <div
          className="absolute border-2 border-[#e7eaec] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{
            left: `${bbox.x}%`,
            top: `${bbox.y}%`,
            width: `${bbox.w}%`,
            height: `${bbox.h}%`,
          }}
        >
          {label && (
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#e7eaec] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#0b0d0e]">
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
