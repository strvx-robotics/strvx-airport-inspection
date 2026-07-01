"use client";

import type { ReactNode } from "react";
import { Layers, Undo2, X } from "lucide-react";
import type { Zone } from "@/lib/types";
import { cn } from "@/lib/cn";
import { BTN, BTN_PRIMARY, CARD, INPUT, MUTED } from "@/lib/vstyle";
import { PanelDropdown } from "./PanelDropdown";

export type BoundaryDrawStep = "details" | "plot" | "confirm";

export function BoundariesModal({
  open,
  step,
  zones,
  lockZoneId,
  busy,
  err,
  name,
  zoneId,
  plotPoints,
  onClose,
  onStep,
  onName,
  onZoneId,
  onUndoPlot,
  onFinishPlot,
  onSave,
}: {
  open: boolean;
  step: BoundaryDrawStep;
  zones: Zone[];
  lockZoneId?: string;
  busy: boolean;
  err: string | null;
  name: string;
  zoneId: string;
  plotPoints: { lat: number; lng: number }[];
  onClose: () => void;
  onStep: (step: BoundaryDrawStep) => void;
  onName: (v: string) => void;
  onZoneId: (v: string) => void;
  onUndoPlot: () => void;
  onFinishPlot: () => void;
  onSave: () => void;
}) {
  if (!open) return null;

  const zoneById = Object.fromEntries(zones.map((z) => [z.id, z] as const));
  const selectedZone = zoneById[zoneId];
  const showZonePick = !lockZoneId;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex justify-end p-3">
      <div
        className={cn(
          "pointer-events-auto flex max-h-[calc(100%-1.5rem)] w-[22rem] max-w-full flex-col overflow-hidden rounded-md border border-[#c7cdd2] shadow-xl",
          CARD,
          step === "plot" && "ring-2 ring-[#2f5b85]/40",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-[#dbdfe3] px-3 py-2.5">
          <Layers size={15} strokeWidth={2} className="text-[#2f5b85]" />
          <span className="text-[13px] font-semibold text-[#181b1e]">Draw boundary</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-7 w-7 cursor-pointer place-items-center rounded-md text-[#6b7176] transition-[background-color,color,box-shadow] duration-200 hover:bg-[#fff1f0] hover:text-[#b23b32] hover:shadow-[0_0_0_2px_rgba(178,59,50,0.18),0_0_14px_rgba(178,59,50,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b23b32]"
            title="Close"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {step === "details" && (
            <div className="space-y-3">
              <p className={cn("text-[12px] leading-relaxed", MUTED)}>
                Name the boundary and pick a zone. You&apos;ll draw it on the map next.
              </p>
              <Field label="Boundary name">
                <input
                  value={name}
                  onChange={(e) => onName(e.target.value)}
                  placeholder="North half · rollout"
                  className={cn(INPUT, "h-9 w-full px-2.5 text-[12px]")}
                  autoFocus
                />
              </Field>
              {showZonePick ? (
                <Field label="Zone">
                  <PanelDropdown
                    label="Zone"
                    value={zoneId}
                    options={zones.map((z) => ({
                      value: z.id,
                      label: `${z.name} · ${z.designation}`,
                    }))}
                    onChange={onZoneId}
                  />
                </Field>
              ) : (
                selectedZone && (
                  <p className={cn("text-[12px]", MUTED)}>
                    Zone: <span className="font-medium text-[#181b1e]">{selectedZone.name}</span>
                  </p>
                )
              )}
              <button
                type="button"
                disabled={!name.trim() || !zoneId}
                onClick={() => onStep("plot")}
                className={cn("h-9 w-full text-[12px]", BTN_PRIMARY)}
              >
                Continue — plot on map
              </button>
            </div>
          )}

          {step === "plot" && (
            <div className="space-y-3">
              <p className={cn("text-[12px] leading-relaxed", MUTED)}>
                Click corners on the map along{" "}
                <span className="font-medium text-[#181b1e]">{selectedZone?.name ?? "the zone"}</span>.
                Need at least 3 points.
              </p>
              <p className="font-mono text-[11px] text-[#181b1e]">{plotPoints.length} point{plotPoints.length === 1 ? "" : "s"} placed</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={plotPoints.length === 0 || busy}
                  onClick={onUndoPlot}
                  className={cn("h-9 flex-1 text-[12px]", BTN)}
                >
                  <Undo2 size={13} strokeWidth={2} />
                  Undo
                </button>
                <button
                  type="button"
                  disabled={plotPoints.length < 3 || busy}
                  onClick={onFinishPlot}
                  className={cn("h-9 flex-1 text-[12px]", BTN_PRIMARY)}
                >
                  Finish shape
                </button>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-3">
              <p className={cn("text-[12px] leading-relaxed", MUTED)}>Name the boundary and review before saving.</p>
              <Field label="Boundary name">
                <input
                  value={name}
                  onChange={(e) => onName(e.target.value)}
                  placeholder="North half · rollout"
                  className={cn(INPUT, "h-9 w-full px-2.5 text-[12px]")}
                  autoFocus
                />
              </Field>
              <dl className="space-y-2 rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-3 py-2.5 text-[12px]">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">Zone</dt>
                  <dd className="text-[#181b1e]">{selectedZone?.name ?? zoneId}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">Boundary</dt>
                  <dd className="text-[#181b1e]">{plotPoints.length} corners</dd>
                </div>
              </dl>
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={onSave}
                className={cn("h-9 w-full text-[12px]", BTN_PRIMARY)}
              >
                {busy ? "Saving…" : "Save boundary"}
              </button>
            </div>
          )}

          {err && <p className="mt-3 text-[11px] font-medium text-[#b23b32]">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{label}</label>
      {children}
    </div>
  );
}
