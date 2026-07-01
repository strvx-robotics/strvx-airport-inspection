"use client";

import type { ReactNode } from "react";
import { Ban, Trash2, X } from "lucide-react";
import type { KeepOutZone, Zone } from "@/lib/types";
import { keepOutZoneLabel } from "@/lib/keepOutGeom";
import { cn } from "@/lib/cn";
import { BTN, BTN_DANGER, BTN_PRIMARY, CARD, INPUT, MUTED } from "@/lib/vstyle";
import { PanelDropdown } from "./PanelDropdown";

export type KeepOutStep = "list" | "details" | "plot" | "confirm";

export function KeepOutZonesModal({
  open,
  step,
  keepOutZones,
  operationalZones,
  focusedZoneId,
  canEdit,
  busy,
  err,
  name,
  reason,
  zoneId,
  plotPoints,
  onClose,
  onStep,
  onName,
  onReason,
  onZoneId,
  onStartCreate,
  onUndoPlot,
  onFinishPlot,
  onSave,
  onToggleActive,
  onDelete,
}: {
  open: boolean;
  step: KeepOutStep;
  keepOutZones: KeepOutZone[];
  operationalZones: Zone[];
  focusedZoneId: string;
  canEdit: boolean;
  busy: boolean;
  err: string | null;
  name: string;
  reason: string;
  zoneId: string;
  plotPoints: { lat: number; lng: number }[];
  onClose: () => void;
  onStep: (step: KeepOutStep) => void;
  onName: (v: string) => void;
  onReason: (v: string) => void;
  onZoneId: (v: string) => void;
  onStartCreate: () => void;
  onUndoPlot: () => void;
  onFinishPlot: () => void;
  onSave: () => void;
  onToggleActive: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  if (!open) return null;

  const zoneById = Object.fromEntries(operationalZones.map((r) => [r.id, r] as const));
  const selectedZone = zoneById[zoneId];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex justify-end p-3">
      <div
        className={cn(
          "pointer-events-auto flex max-h-[calc(100%-1.5rem)] w-[22rem] max-w-full flex-col overflow-hidden rounded-md border border-[#c7cdd2] shadow-xl",
          CARD,
          step === "plot" && "ring-2 ring-[#b23b32]/40",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-[#dbdfe3] px-3 py-2.5">
          <Ban size={15} strokeWidth={2} className="text-[#b23b32]" />
          <span className="text-[13px] font-semibold text-[#181b1e]">No-drone areas</span>
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
          {step === "list" && (
            <ListStep
              keepOutZones={keepOutZones}
              zoneById={zoneById}
              canEdit={canEdit}
              busy={busy}
              onStartCreate={onStartCreate}
              onToggleActive={onToggleActive}
              onDelete={onDelete}
            />
          )}

          {step === "details" && (
            <DetailsStep
              name={name}
              reason={reason}
              zoneId={zoneId}
              operationalZones={operationalZones}
              showZonePick={focusedZoneId === "all"}
              onName={onName}
              onReason={onReason}
              onZoneId={onZoneId}
              onContinue={() => onStep("plot")}
              disabled={!name.trim() || !zoneId}
            />
          )}

          {step === "plot" && (
            <PlotStep
              pointCount={plotPoints.length}
              zone={selectedZone}
              onUndo={onUndoPlot}
              onFinish={onFinishPlot}
              canFinish={plotPoints.length >= 3}
            />
          )}

          {step === "confirm" && (
            <ConfirmStep
              name={name}
              reason={reason}
              zone={selectedZone}
              pointCount={plotPoints.length}
              busy={busy}
              onSave={onSave}
            />
          )}

          {err && <p className="mt-3 text-[11px] font-medium text-[#b23b32]">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function ListStep({
  keepOutZones,
  zoneById,
  canEdit,
  busy,
  onStartCreate,
  onToggleActive,
  onDelete,
}: {
  keepOutZones: KeepOutZone[];
  zoneById: Record<string, Zone>;
  canEdit: boolean;
  busy: boolean;
  onStartCreate: () => void;
  onToggleActive: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className={cn("text-[12px] leading-relaxed", MUTED)}>
        Mark areas where drones must not fly. Areas are drawn on the map — no manual coordinates.
      </p>
      {keepOutZones.length === 0 ? (
        <p className={cn("text-[12px]", MUTED)}>No areas marked yet.</p>
      ) : (
        <ul className="space-y-2">
          {keepOutZones.map((z) => (
            <li
              key={z.id}
              className={cn(
                "rounded-md border px-2.5 py-2",
                z.active ? "border-[#b23b32]/30 bg-[#b23b32]/5" : "border-[#dbdfe3] bg-[#f3f5f7] opacity-75",
              )}
            >
              <p className="text-[12px] font-semibold text-[#181b1e]">{z.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-[#6b7176]">
                {keepOutZoneLabel(z, zoneById[z.zoneId])}
              </p>
              {z.reason && <p className="mt-1 text-[11px] text-[#5b6166]">{z.reason}</p>}
              {canEdit && (
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onToggleActive(z.id, !z.active)}
                    className={cn("h-7 flex-1 text-[11px]", BTN)}
                  >
                    {z.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDelete(z.id)}
                    className="grid h-7 w-8 place-items-center rounded-md border border-[#dbdfe3] text-[#6b7176] hover:text-[#b23b32]"
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <button type="button" onClick={onStartCreate} className={cn("h-9 w-full text-[12px]", BTN_PRIMARY)}>
          New no-drone area
        </button>
      ) : (
        <p className={cn("text-[11px]", MUTED)}>Switch to Inspector to create areas.</p>
      )}
    </div>
  );
}

function DetailsStep({
  name,
  reason,
  zoneId,
  operationalZones,
  showZonePick,
  onName,
  onReason,
  onZoneId,
  onContinue,
  disabled,
}: {
  name: string;
  reason: string;
  zoneId: string;
  operationalZones: Zone[];
  showZonePick: boolean;
  onName: (v: string) => void;
  onReason: (v: string) => void;
  onZoneId: (v: string) => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className={cn("text-[12px] leading-relaxed", MUTED)}>Step 1 — describe the restriction.</p>
      <Field label="Label">
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Work crew · midfield"
          className={cn(INPUT, "h-9 w-full px-2.5 text-[12px]")}
          autoFocus
        />
      </Field>
      {showZonePick && (
        <Field label="Zone">
          <PanelDropdown
            label="Zone"
            value={zoneId}
            options={operationalZones.map((r) => ({
              value: r.id,
              label: `${r.designation} · ${r.name}`,
            }))}
            onChange={onZoneId}
          />
        </Field>
      )}
      <Field label="Reason (optional)">
        <input
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder="Paving crew on surface"
          className={cn(INPUT, "h-9 w-full px-2.5 text-[12px]")}
        />
      </Field>
      <button type="button" disabled={disabled} onClick={onContinue} className={cn("h-9 w-full text-[12px]", BTN_PRIMARY)}>
        Continue — plot on map
      </button>
    </div>
  );
}

function PlotStep({
  pointCount,
  zone,
  onUndo,
  onFinish,
  canFinish,
}: {
  pointCount: number;
  zone?: Zone;
  onUndo: () => void;
  onFinish: () => void;
  canFinish: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className={cn("text-[12px] leading-relaxed", MUTED)}>
        Step 2 — click the map to outline the no-drone area
        {zone ? ` near ${zone.designation}` : ""}. Each click adds a corner.
      </p>
      <div className="rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-3 py-2.5">
        <p className="font-mono text-[11px] text-[#181b1e]">
          {pointCount} point{pointCount === 1 ? "" : "s"} plotted
        </p>
        <p className={cn("mt-1 text-[10px]", MUTED)}>Need at least 3 corners to close the shape.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onUndo} disabled={pointCount === 0} className={cn("h-9 text-[12px]", BTN)}>
          Undo last
        </button>
        <button type="button" onClick={onFinish} disabled={!canFinish} className={cn("h-9 text-[12px]", BTN_PRIMARY)}>
          Finish outline
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({
  name,
  reason,
  zone,
  pointCount,
  busy,
  onSave,
}: {
  name: string;
  reason?: string;
  zone?: Zone;
  pointCount: number;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className={cn("text-[12px] leading-relaxed", MUTED)}>Step 3 — confirm and save.</p>
      <dl className="space-y-2 rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-3 py-2.5 text-[12px]">
        <Row term="Label" detail={name} />
        {zone && <Row term="Zone" detail={zone.designation} />}
        <Row term="Outline" detail={`${pointCount} map points`} />
        {reason && <Row term="Reason" detail={reason} />}
      </dl>
      <button type="button" disabled={busy} onClick={onSave} className={cn("h-9 w-full text-[12px]", BTN_PRIMARY)}>
        {busy ? "Saving…" : "Save no-drone area"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7176]">{label}</label>
      {children}
    </div>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#9aa1a6]">{term}</dt>
      <dd className="mt-0.5 text-[#181b1e]">{detail}</dd>
    </div>
  );
}

