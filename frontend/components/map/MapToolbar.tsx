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
  RotateCcw,
  Save,
  Square,
} from "lucide-react";
import { MapPanel } from "./MapPanel";
import { DECISION, SEVERITY } from "@/lib/ui";
import type { IssueStatus, Runway, Severity } from "@/lib/types";
import { DOT } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

export type LayerKey = "satellite" | "runways" | "zones" | "issues";
export type LayerVis = Record<LayerKey, boolean>;

const LAYER_ROWS: { key: LayerKey; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; label: string }[] = [
  { key: "satellite", icon: Satellite, label: "Satellite" },
  { key: "runways", icon: Plane, label: "Runways" },
  { key: "zones", icon: SquareDashed, label: "Zones" },
  { key: "issues", icon: MapPin, label: "Issues" },
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const STATUSES: IssueStatus[] = ["pending", "manual_review", "approved", "rejected"];
const STATUS_DOT: Record<IssueStatus, string> = {
  pending: "bg-[#caa44e]",
  manual_review: "bg-[#8d78bd]",
  approved: "bg-[#44b07f]",
  rejected: "bg-[#b23b32] ring-2 ring-[#b23b32]/25",
};

/** Left-edge tool rail: layer visibility, severity filter, recenter, markers. */
export function MapToolbar({
  collapsed,
  onToggleCollapsed,
  layers,
  onToggleLayer,
  severities,
  onToggleSeverity,
  statuses,
  onToggleStatus,
  onRecenter,
  addMode,
  onToggleAddMode,
  runways,
  selectedRunwayId,
  onSelectRunway,
  areaDrawMode,
  onToggleAreaDraw,
  areaPointCount,
  areaCanSave,
  areaSaving,
  areaMessage,
  onSaveArea,
  onResetArea,
  onClearArea,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  layers: LayerVis;
  onToggleLayer: (k: LayerKey) => void;
  severities: Set<Severity>;
  onToggleSeverity: (s: Severity) => void;
  statuses: Set<IssueStatus>;
  onToggleStatus: (s: IssueStatus) => void;
  onRecenter: () => void;
  addMode: boolean;
  onToggleAddMode: () => void;
  runways: Runway[];
  selectedRunwayId: string;
  onSelectRunway: (id: string) => void;
  areaDrawMode: boolean;
  onToggleAreaDraw: () => void;
  areaPointCount: number;
  areaCanSave: boolean;
  areaSaving: boolean;
  areaMessage?: string;
  onSaveArea: () => void;
  onResetArea: () => void;
  onClearArea: () => void;
}) {
  return (
    <MapPanel
      title="Layers"
      icon={Layers}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      className="pointer-events-auto absolute left-3 top-3 z-10 w-56"
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
          Status filter
        </p>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onToggleStatus(s)}
            disabled={!layers.issues}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-35",
              statuses.has(s) ? "text-[#181b1e]" : "text-[#6b7176] hover:text-[#3f4448]",
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[s])} />
            <span className="flex-1 font-mono text-[11px] tracking-wide">{DECISION[s].label}</span>
            {statuses.has(s) && <Check size={13} strokeWidth={2.4} />}
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

        <Divider />
        <p className="px-2 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-[#9aa1a6]">
          Runway areas
        </p>
        <select
          value={selectedRunwayId}
          onChange={(e) => onSelectRunway(e.target.value)}
          className="mx-2 h-8 rounded border border-[#c7cdd2] bg-white px-2 font-mono text-[11px] text-[#181b1e] outline-none focus:border-[#6b7176]"
          aria-label="Select runway area"
        >
          {runways.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.designation}
            </option>
          ))}
        </select>
        <button
          onClick={onToggleAreaDraw}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
            areaDrawMode
              ? "bg-[#181b1e] text-[#eef1f4]"
              : "text-[#3f4448] hover:bg-white/5 hover:text-[#181b1e]",
          )}
        >
          <Square size={15} strokeWidth={2.1} className={areaDrawMode ? "text-[#eef1f4]" : "text-[#5b6166]"} />
          <span className="flex-1 font-mono text-[11px] tracking-wide">Draw area</span>
          <span className={cn("font-mono text-[10px]", areaDrawMode ? "text-[#dce2e8]" : "text-[#9aa1a6]")}>
            {areaPointCount}/4
          </span>
        </button>
        <div className="grid grid-cols-3 gap-1 px-2 pt-1">
          <button
            onClick={onSaveArea}
            disabled={!areaCanSave || areaSaving}
            className="flex h-7 items-center justify-center rounded border border-[#c7cdd2] bg-white text-[#3f4448] transition-colors hover:text-[#181b1e] disabled:cursor-not-allowed disabled:opacity-35"
            title="Save area"
            aria-label="Save runway area"
          >
            <Save size={13} strokeWidth={2} />
          </button>
          <button
            onClick={onResetArea}
            disabled={areaSaving}
            className="flex h-7 items-center justify-center rounded border border-[#c7cdd2] bg-white text-[#3f4448] transition-colors hover:text-[#181b1e] disabled:cursor-not-allowed disabled:opacity-35"
            title="Reset draft"
            aria-label="Reset runway area draft"
          >
            <RotateCcw size={13} strokeWidth={2} />
          </button>
          <button
            onClick={onClearArea}
            disabled={areaSaving}
            className="flex h-7 items-center justify-center rounded border border-[#c7cdd2] bg-white font-mono text-[10px] uppercase tracking-wide text-[#3f4448] transition-colors hover:text-[#181b1e] disabled:cursor-not-allowed disabled:opacity-35"
          >
            Clear
          </button>
        </div>
        {areaMessage && (
          <p className="px-2 pt-1 font-mono text-[10px] leading-snug text-[#6b7176]">{areaMessage}</p>
        )}
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
