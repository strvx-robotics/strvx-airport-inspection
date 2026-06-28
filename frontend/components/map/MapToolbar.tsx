"use client";

import type { ComponentType } from "react";
import {
  Layers,
  Crosshair,
  Check,
  Satellite,
  Plane,
  SquareDashed,
  MapPin,
  Plus,
} from "lucide-react";
import { MapPanel } from "./MapPanel";
import { SEVERITY } from "@/lib/ui";
import type { Severity } from "@/lib/types";
import { DOT } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

export type LayerKey = "satellite" | "runways" | "zones" | "centerline" | "issues";
export type LayerVis = Record<LayerKey, boolean>;

// Centerline is always drawn (not user-toggleable) — it's reference geometry.
const LAYER_ROWS: { key: LayerKey; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; label: string }[] = [
  { key: "satellite", icon: Satellite, label: "Satellite" },
  { key: "runways", icon: Plane, label: "Runways" },
  { key: "zones", icon: SquareDashed, label: "Zones" },
  { key: "issues", icon: MapPin, label: "Issues" },
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/** Left-edge tool rail: layer visibility, severity filter, recenter, markers. */
export function MapToolbar({
  collapsed,
  onToggleCollapsed,
  layers,
  onToggleLayer,
  severities,
  onToggleSeverity,
  onRecenter,
  addMode,
  onToggleAddMode,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  layers: LayerVis;
  onToggleLayer: (k: LayerKey) => void;
  severities: Set<Severity>;
  onToggleSeverity: (s: Severity) => void;
  onRecenter: () => void;
  addMode: boolean;
  onToggleAddMode: () => void;
}) {
  return (
    <MapPanel
      title="Layers"
      icon={Layers}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      className="pointer-events-auto absolute left-3 top-3 z-10 w-48"
    >
      <div className="flex flex-col gap-0.5 p-1.5">
        <button
          onClick={onRecenter}
          className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[#3f4448] transition-colors hover:bg-white/5 hover:text-[#181b1e]"
        >
          <Crosshair size={15} strokeWidth={1.9} className="text-[#5b6166]" />
          <span className="font-mono text-[11px] tracking-wide">Recenter</span>
        </button>
        <Divider />

        {LAYER_ROWS.map((r) => (
          <Toggle key={r.key} icon={r.icon} label={r.label} on={layers[r.key]} onClick={() => onToggleLayer(r.key)} />
        ))}

        <Divider />
        <p className="px-2 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-[#9aa1a6]">
          Severity filter
        </p>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => onToggleSeverity(s)}
            disabled={!layers.issues}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-35",
              severities.has(s) ? "text-[#181b1e]" : "text-[#6b7176] hover:text-[#3f4448]",
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[s])} />
            <span className="flex-1 font-mono text-[11px] tracking-wide">{SEVERITY[s].label}</span>
            {severities.has(s) && <Check size={13} strokeWidth={2.4} />}
          </button>
        ))}

        <Divider />
        <p className="px-2 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-[#9aa1a6]">
          Markers
        </p>
        <button
          onClick={onToggleAddMode}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
            addMode
              ? "bg-[#181b1e] text-[#eef1f4]"
              : "text-[#3f4448] hover:bg-white/5 hover:text-[#181b1e]",
          )}
        >
          <Plus size={15} strokeWidth={2.1} className={addMode ? "text-[#eef1f4]" : "text-[#5b6166]"} />
          <span className="flex-1 font-mono text-[11px] tracking-wide">
            {addMode ? "Click map to drop…" : "Add marker"}
          </span>
        </button>
        <p className="px-2 pt-1 font-mono text-[10px] leading-snug text-[#9aa1a6]">
          Click a marker to rename or delete it.
        </p>
      </div>
    </MapPanel>
  );
}

function Toggle({
  icon: Icon,
  label,
  on,
  onClick,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
        on ? "text-[#181b1e]" : "text-[#6b7176] hover:text-[#3f4448]",
      )}
    >
      <Icon size={15} strokeWidth={1.9} className={on ? "text-[#181b1e]" : "text-[#9aa1a6]"} />
      <span className="flex-1 font-mono text-[11px] tracking-wide">{label}</span>
      {on && <Check size={13} strokeWidth={2.4} />}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-white/8" />;
}
