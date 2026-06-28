"use client";

import type { ComponentType } from "react";
import {
  Layers,
  Crosshair,
  Check,
  Satellite,
  Plane,
  SquareDashed,
  Minus,
  MapPin,
} from "lucide-react";
import { MapPanel } from "./MapPanel";
import { SEVERITY } from "@/lib/ui";
import type { Severity } from "@/lib/types";
import { DOT } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

export type LayerKey = "satellite" | "runways" | "zones" | "centerline" | "issues";
export type LayerVis = Record<LayerKey, boolean>;

const LAYER_ROWS: { key: LayerKey; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; label: string }[] = [
  { key: "satellite", icon: Satellite, label: "Satellite" },
  { key: "runways", icon: Plane, label: "Runways" },
  { key: "zones", icon: SquareDashed, label: "Zones" },
  { key: "centerline", icon: Minus, label: "Centerline" },
  { key: "issues", icon: MapPin, label: "Issues" },
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/** Left-edge tool rail: layer visibility, severity filter, recenter. */
export function MapToolbar({
  collapsed,
  onToggleCollapsed,
  layers,
  onToggleLayer,
  severities,
  onToggleSeverity,
  onRecenter,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  layers: LayerVis;
  onToggleLayer: (k: LayerKey) => void;
  severities: Set<Severity>;
  onToggleSeverity: (s: Severity) => void;
  onRecenter: () => void;
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
        {LAYER_ROWS.map((r) => (
          <Toggle key={r.key} icon={r.icon} label={r.label} on={layers[r.key]} onClick={() => onToggleLayer(r.key)} />
        ))}

        <Divider />
        <p className="px-2 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-[#5b6166]">
          Severity filter
        </p>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => onToggleSeverity(s)}
            disabled={!layers.issues}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-35",
              severities.has(s) ? "text-[#e7eaec]" : "text-[#737a7f] hover:text-[#c2c8cc]",
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[s])} />
            <span className="flex-1 font-mono text-[11px] tracking-wide">{SEVERITY[s].label}</span>
            {severities.has(s) && <Check size={13} strokeWidth={2.4} />}
          </button>
        ))}

        <Divider />
        <button
          onClick={onRecenter}
          className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[#c2c8cc] transition-colors hover:bg-white/5 hover:text-[#e7eaec]"
        >
          <Crosshair size={15} strokeWidth={1.9} className="text-[#9aa1a6]" />
          <span className="font-mono text-[11px] tracking-wide">Recenter</span>
        </button>
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
        on ? "text-[#e7eaec]" : "text-[#737a7f] hover:text-[#c2c8cc]",
      )}
    >
      <Icon size={15} strokeWidth={1.9} className={on ? "text-[#e7eaec]" : "text-[#5b6166]"} />
      <span className="flex-1 font-mono text-[11px] tracking-wide">{label}</span>
      {on && <Check size={13} strokeWidth={2.4} />}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-white/8" />;
}
