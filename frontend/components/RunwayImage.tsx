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
      className={`relative w-full overflow-hidden rounded-lg ring-1 ring-black/10 ${heightClass}`}
      style={{
        background:
          "repeating-linear-gradient(180deg, #3f3f46 0 38px, #45454d 38px 40px)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2"
        style={{
          background:
            "repeating-linear-gradient(#facc15 0 26px, transparent 26px 52px)",
          opacity: 0.85,
        }}
      />
      {bbox && (
        <div
          className="absolute border-2 border-red-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.10)]"
          style={{
            left: `${bbox.x}%`,
            top: `${bbox.y}%`,
            width: `${bbox.w}%`,
            height: `${bbox.h}%`,
          }}
        >
          {label && (
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
