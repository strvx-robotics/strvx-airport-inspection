"use client";

import type { ReactNode } from "react";
import { Ban, ChevronLeft, Trash2, X } from "lucide-react";
import type { KeepOutZone, Runway } from "@/lib/types";
import { keepOutZoneLabel } from "@/lib/keepOutGeom";
import { cn } from "@/lib/cn";
import { BTN, BTN_DANGER, BTN_PRIMARY, CARD, INPUT, MUTED } from "@/lib/vstyle";

export type KeepOutStep = "list" | "details" | "plot" | "confirm";

export function KeepOutZonesModal({
  open,
  step,
  zones,
  runways,
  focusedRunwayId,
  canEdit,
  busy,
  err,
  name,
  reason,
  runwayId,
  plotPoints,
  onClose,
  onStep,
  onName,
  onReason,
  onRunwayId,
  onStartCreate,
  onUndoPlot,
  onFinishPlot,
  onSave,
  onToggleActive,
  onDelete,
}: {
  open: boolean;
  step: KeepOutStep;
  zones: KeepOutZone[];
  runways: Runway[];
  focusedRunwayId: string;
  canEdit: boolean;
  busy: boolean;
  err: string | null;
  name: string;
  reason: string;
  runwayId: string;
  plotPoints: { lat: number; lng: number }[];
  onClose: () => void;
  onStep: (step: KeepOutStep) => void;
  onName: (v: string) => void;
  onReason: (v: string) => void;
  onRunwayId: (v: string) => void;
  onStartCreate: () => void;
  onUndoPlot: () => void;
  onFinishPlot: () => void;
  onSave: () => void;
  onToggleActive: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  if (!open) return null;

  const runwayById = Object.fromEntries(runways.map((r) => [r.id, r] as const));
  const selectedRunway = runwayById[runwayId];

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
          <span className="text-[13px] font-semibold text-[#181b1e]">Keep-out zones</span>
          {step !== "list" && (
            <button
              type="button"
              onClick={() => onStep(step === "confirm" ? "plot" : step === "plot" ? "details" : "list")}
              className="ml-1 grid h-7 w-7 place-items-center rounded-md text-[#6b7176] hover:bg-[#eef1f4]"
              title="Back"
            >
              <ChevronLeft size={14} strokeWidth={2.2} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[#6b7176] hover:bg-[#eef1f4]"
            title="Close"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {step === "list" && (
            <ListStep
              zones={zones}
              runwayById={runwayById}
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
              runwayId={runwayId}
              runways={runways}
              showRunwayPick={focusedRunwayId === "all"}
              onName={onName}
              onReason={onReason}
              onRunwayId={onRunwayId}
              onContinue={() => onStep("plot")}
              disabled={!name.trim() || !runwayId}
            />
          )}

          {step === "plot" && (
            <PlotStep
              pointCount={plotPoints.length}
              runway={selectedRunway}
              onUndo={onUndoPlot}
              onFinish={onFinishPlot}
              canFinish={plotPoints.length >= 3}
            />
          )}

          {step === "confirm" && (
            <ConfirmStep
              name={name}
              reason={reason}
              runway={selectedRunway}
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
  zones,
  runwayById,
  canEdit,
  busy,
  onStartCreate,
  onToggleActive,
  onDelete,
}: {
  zones: KeepOutZone[];
  runwayById: Record<string, Runway>;
  canEdit: boolean;
  busy: boolean;
  onStartCreate: () => void;
  onToggleActive: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className={cn("text-[12px] leading-relaxed", MUTED)}>
        Mark areas where drones must not fly. Zones are drawn on the map — no manual coordinates.
      </p>
      {zones.length === 0 ? (
        <p className={cn("text-[12px]", MUTED)}>No keep-out zones yet.</p>
      ) : (
        <ul className="space-y-2">
          {zones.map((z) => (
            <li
              key={z.id}
              className={cn(
                "rounded-md border px-2.5 py-2",
                z.active ? "border-[#b23b32]/30 bg-[#b23b32]/5" : "border-[#dbdfe3] bg-[#f3f5f7] opacity-75",
              )}
            >
              <p className="text-[12px] font-semibold text-[#181b1e]">{z.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-[#6b7176]">
                {keepOutZoneLabel(z, runwayById[z.runwayId])}
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
          New keep-out zone
        </button>
      ) : (
        <p className={cn("text-[11px]", MUTED)}>Switch to Inspector to create zones.</p>
      )}
    </div>
  );
}

function DetailsStep({
  name,
  reason,
  runwayId,
  runways,
  showRunwayPick,
  onName,
  onReason,
  onRunwayId,
  onContinue,
  disabled,
}: {
  name: string;
  reason: string;
  runwayId: string;
  runways: Runway[];
  showRunwayPick: boolean;
  onName: (v: string) => void;
  onReason: (v: string) => void;
  onRunwayId: (v: string) => void;
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
      {showRunwayPick && (
        <Field label="Runway">
          <select
            value={runwayId}
            onChange={(e) => onRunwayId(e.target.value)}
            className={cn(INPUT, "h-9 w-full px-2.5 text-[12px]")}
          >
            {runways.map((r) => (
              <option key={r.id} value={r.id}>
                {r.designation} · {r.name}
              </option>
            ))}
          </select>
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
  runway,
  onUndo,
  onFinish,
  canFinish,
}: {
  pointCount: number;
  runway?: Runway;
  onUndo: () => void;
  onFinish: () => void;
  canFinish: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className={cn("text-[12px] leading-relaxed", MUTED)}>
        Step 2 — click the map to outline the keep-out area
        {runway ? ` near ${runway.designation}` : ""}. Each click adds a corner.
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
  runway,
  pointCount,
  busy,
  onSave,
}: {
  name: string;
  reason?: string;
  runway?: Runway;
  pointCount: number;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className={cn("text-[12px] leading-relaxed", MUTED)}>Step 3 — confirm and save.</p>
      <dl className="space-y-2 rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-3 py-2.5 text-[12px]">
        <Row term="Label" detail={name} />
        {runway && <Row term="Runway" detail={runway.designation} />}
        <Row term="Outline" detail={`${pointCount} map points`} />
        {reason && <Row term="Reason" detail={reason} />}
      </dl>
      <button type="button" disabled={busy} onClick={onSave} className={cn("h-9 w-full text-[12px]", BTN_PRIMARY)}>
        {busy ? "Saving…" : "Save keep-out zone"}
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

/** Floating map trigger — not in the left toolbar. */
export function KeepOutMapTrigger({ activeCount, onClick }: { activeCount: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto absolute left-3 top-14 z-10 flex items-center gap-2 rounded-md border border-[#c7cdd2] bg-[#fbfcfd]/95 px-3 py-2 shadow-md backdrop-blur-sm transition-colors hover:bg-[#eef1f4]"
    >
      <Ban size={15} strokeWidth={2} className="text-[#b23b32]" />
      <span className="font-mono text-[11px] font-semibold tracking-wide text-[#181b1e]">Keep-out zones</span>
      {activeCount > 0 && (
        <span className="rounded-full bg-[#b23b32] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[#fbfcfd]">
          {activeCount}
        </span>
      )}
    </button>
  );
}
