"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Layers, Trash2 } from "lucide-react";
import Badge from "@/components/Badge";
import ConfirmDeleteModal from "@/components/ConfirmDeleteModal";
import SelectMenu from "@/components/Select";
import * as api from "@/lib/api";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  MAP_STATUS_LABEL,
  mapStatusTone,
} from "@/lib/runwayAdmin";
import type { Runway, RunwayMapStatus, Zone } from "@/lib/types";
import { RUNWAY_MAP_STATUSES } from "@/lib/types";
import { useStore } from "@/lib/store";
import {
  BAR,
  BTN,
  BTN_DANGER,
  BTN_PRIMARY,
  CARD,
  EYEBROW,
  INPUT,
  METRIC_CELL,
  MUTED,
  PAGE,
} from "@/lib/vstyle";

const MAP_STATUS_HELP: Record<RunwayMapStatus, string> = {
  draft: "Polygon defined but not yet approved for inspections.",
  active: "Current operational boundary used for zone placement.",
  retired: "Historical boundary — no longer used for new passes.",
  needs_review: "Boundary flagged for admin review before next pass.",
};

export default function AdminRunwayPage() {
  const { role } = useStore();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [runway, setRunway] = useState<Runway | null>(null);
  const [zones, setZones] = useState<Zone[] | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const [pendingRunwayDelete, setPendingRunwayDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.getRunway(id);
      setRunway(detail.runway);
      setErr(null);
    } catch (e) {
      setRunway(null);
      setErr(apiErrorMessage(e, "Runway not found."));
    }
  }, [id]);

  const loadZones = useCallback(async () => {
    try {
      setZones(await api.listZones(id));
    } catch {
      setZones([]);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadZones();
  }, [load, loadZones]);

  if (role !== "admin") {
    return (
      <Shell>
        <p className={cn("text-[13px]", MUTED)}>Switch to the Admin role to manage runways.</p>
      </Shell>
    );
  }

  if (!runway) {
    return (
      <Shell>
        <BackLink />
        <p className={cn("mt-4 text-[13px]", MUTED)}>{err ?? "Loading runway…"}</p>
      </Shell>
    );
  }

  const mapped = Boolean(runway.runwayPolygon?.length);
  const mapTone = mapStatusTone(runway.mapStatus, mapped);
  const retired = runway.activeStatus === "retired";

  return (
    <Shell>
      {pendingRunwayDelete && (
        <ConfirmDeleteModal
          title="Delete runway"
          description="This removes the runway from the airfield configuration. Past inspection records are kept for reports and training."
          itemLabel={`${runway.name} · ${runway.designation}`}
          onCancel={() => {
            if (!deleteBusy) setPendingRunwayDelete(false);
          }}
          onConfirm={async () => {
            setDeleteBusy(true);
            setDeleteErr(null);
            try {
              await api.deleteRunway(runway.id);
              setPendingRunwayDelete(false);
              router.push("/admin?section=runways");
            } catch (e) {
              setDeleteErr(apiErrorMessage(e, "Failed to delete runway."));
            } finally {
              setDeleteBusy(false);
            }
          }}
        />
      )}
      <div className="grid h-full min-h-0 flex-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:items-stretch">
        <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden lg:sticky lg:top-0 lg:self-stretch", CARD)}>
          <div className={cn("border-b border-[#dfe4e8] px-4 py-3", BAR)}>
            <BackLink />
            <p className={cn("mt-3", EYEBROW)}>Runway</p>
            <p className="mt-1 text-[14px] font-semibold text-[#181b1e]">{runway.name}</p>
            <p className={cn("mt-0.5 font-mono text-[12px]", MUTED)}>{runway.designation}</p>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={retired ? "gray" : "green"}>{runway.activeStatus ?? "active"}</Badge>
              <Badge tone={mapTone}>
                {mapped ? MAP_STATUS_LABEL[runway.mapStatus ?? "draft"] : "Unmapped"}
              </Badge>
            </div>
            <dl className="space-y-2 border-t border-[#dbdfe3] pt-3">
              <InfoRow label="Runway ID" value={runway.id} mono />
              {runway.length && <InfoRow label="Length" value={runway.length} />}
              <InfoRow
                label="Zone"
                value={
                  zones === undefined
                    ? "…"
                    : zones.length === 0
                      ? "Not drawn"
                      : zones.length === 1
                        ? zones[0].name
                        : `${zones.length} — pick one`
                }
              />
            </dl>
          </div>
        </aside>

        <section className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", CARD)}>
          <div className={cn("border-b border-[#dfe4e8] px-5 py-3.5", BAR)}>
            <p className={EYEBROW}>Runway configuration</p>
            <p className="mt-1 text-[12px] text-[#5b6166]">
              Identity, map status, and the inspection zone for this runway.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-8">
            <RunwayEditor
              runway={runway}
              zones={zones ?? []}
              zonesLoading={zones === undefined}
              onSaved={async () => {
                await load();
              }}
              onZonesChanged={() => {
                void loadZones();
              }}
              onRequestDelete={() => setPendingRunwayDelete(true)}
            />

            {deleteErr && (
              <p className="mt-4 text-[12px] font-medium text-[#b91c1c]">{deleteErr}</p>
            )}
          </div>
        </section>

        <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden lg:sticky lg:top-0 lg:self-stretch", CARD)}>
          <div className={cn("border-b border-[#dfe4e8] px-4 py-3", BAR)}>
            <p className={EYEBROW}>Map status</p>
            <p className="mt-1 text-[12px] text-[#5b6166]">
              Draw inspection zones on the satellite map — not entered as coordinates here.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <dl className="space-y-3">
              {RUNWAY_MAP_STATUSES.map((s) => (
                <div key={s} className="space-y-1">
                  <dt>
                    <Badge tone={s === "active" ? "green" : s === "needs_review" ? "amber" : "gray"}>
                      {MAP_STATUS_LABEL[s]}
                    </Badge>
                  </dt>
                  <dd className="text-[12px] leading-relaxed text-[#3f4448]">{MAP_STATUS_HELP[s]}</dd>
                </div>
              ))}
              <div className="space-y-0.5 border-t border-[#dbdfe3] pt-3">
                <dt className="text-[12px] font-semibold text-[#181b1e]">Inspection zone</dt>
                <dd className="text-[12px] leading-relaxed text-[#3f4448]">
                  Each runway has one zone, drawn on the satellite map. Hover it on the map to edit or delete.
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[12px] font-semibold text-[#181b1e]">Delete vs retire</dt>
                <dd className="text-[12px] leading-relaxed text-[#3f4448]">
                  Delete removes runway or zone configuration from the map and admin views.
                  Inspection history stays in the database for reports and model training.
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("h-full overflow-hidden px-6 py-6", PAGE)}>
      <div className="mx-auto flex h-full min-h-0 max-w-[88rem] flex-col">{children}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin?section=runways"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-[#c7cdd2] bg-[#fbfcfd] px-3 text-[12px] font-medium text-[#5b6166] transition-colors hover:border-[#a8afb5] hover:bg-[#eef1f4] hover:text-[#181b1e]",
        BTN,
      )}
    >
      <ChevronLeft size={14} strokeWidth={2} />
      Runways & zones
    </Link>
  );
}

function Panel({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-start justify-between gap-3 px-5 py-3.5", BAR)}>
        <div>
          <h2 className="text-[14px] font-semibold text-[#181b1e]">{title}</h2>
          {desc && <p className={cn("mt-0.5 text-[12px]", MUTED)}>{desc}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className={EYEBROW}>{label}</dt>
      <dd className={cn("mt-0.5 text-[12px] text-[#181b1e]", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function RunwayEditor({
  runway,
  zones,
  zonesLoading,
  onSaved,
  onZonesChanged,
  onRequestDelete,
}: {
  runway: Runway;
  zones: Zone[];
  zonesLoading: boolean;
  onSaved: () => void | Promise<void>;
  onZonesChanged: () => void;
  onRequestDelete: () => void;
}) {
  const [name, setName] = useState(runway.name);
  const [designation, setDesignation] = useState(runway.designation);
  const [length, setLength] = useState(runway.length ?? "");
  const [mapStatus, setMapStatus] = useState<RunwayMapStatus>(runway.mapStatus ?? "draft");
  const [busy, setBusy] = useState(false);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [pendingKeep, setPendingKeep] = useState<Zone | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(runway.name);
    setDesignation(runway.designation);
    setLength(runway.length ?? "");
    setMapStatus(runway.mapStatus ?? "draft");
  }, [runway]);

  const mapped = Boolean(runway.runwayPolygon?.length);
  const retired = runway.activeStatus === "retired";
  const dirty =
    name !== runway.name ||
    designation !== runway.designation ||
    length !== (runway.length ?? "") ||
    mapStatus !== (runway.mapStatus ?? "draft");

  const act = async (fn: () => Promise<unknown>, opts?: { refresh?: boolean }) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      if (opts?.refresh !== false) await onSaved();
    } catch (e) {
      setErr(apiErrorMessage(e, "Action failed."));
    } finally {
      setBusy(false);
    }
  };

  const keepOnlyZone = async (keepId: string) => {
    setZoneBusy(true);
    setErr(null);
    try {
      for (const z of zones.filter((x) => x.id !== keepId)) {
        await api.deleteZone(z.id, { reassignToZoneId: keepId });
      }
      setPendingKeep(null);
      onZonesChanged();
    } catch (e) {
      setErr(apiErrorMessage(e, "Failed to consolidate zones."));
    } finally {
      setZoneBusy(false);
    }
  };

  return (
    <Panel
      title="Runway details"
      desc="Name, designation, map status, and inspection zone."
      action={
        <div className="flex flex-wrap gap-2">
          <Badge tone={retired ? "gray" : "green"}>{runway.activeStatus ?? "active"}</Badge>
          <Badge tone={mapStatusTone(mapStatus, mapped)}>
            {MAP_STATUS_LABEL[mapStatus]}
          </Badge>
        </div>
      }
    >
      <div className="space-y-5">
        {pendingKeep && (
          <ConfirmDeleteModal
            title="Keep this zone"
            description={`Remove ${zones.length - 1} other zone${zones.length === 2 ? "" : "s"} from this runway. Any inspection history on removed zones will move to "${pendingKeep.name}".`}
            itemLabel={pendingKeep.name}
            confirmLabel="Keep this zone"
            onCancel={() => {
              if (!zoneBusy) setPendingKeep(null);
            }}
            onConfirm={() => keepOnlyZone(pendingKeep.id)}
          />
        )}
        <div className="grid gap-px overflow-hidden rounded-md border border-[#dbdfe3] bg-[#dbdfe3] sm:grid-cols-2">
          <Metric label="Designation" value={runway.designation} detail="threshold pair" />
          <Metric label="Length" value={runway.length || "—"} detail="published length" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Designation" value={designation} onChange={setDesignation} />
          <Field label="Length" value={length} onChange={setLength} placeholder="7,000 ft" />
          <div className="space-y-1">
            <label className={EYEBROW}>Map status</label>
            <SelectMenu
              value={mapStatus}
              options={RUNWAY_MAP_STATUSES.map((s) => ({ value: s, label: MAP_STATUS_LABEL[s] }))}
              onChange={(v) => setMapStatus(v as RunwayMapStatus)}
              ariaLabel="Map status"
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-[#dbdfe3] pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={EYEBROW}>Inspection zone</p>
              <p className={cn("mt-0.5 text-[12px]", MUTED)}>
                One zone per runway — plot on the satellite map.
              </p>
            </div>
            {!zonesLoading && zones.length === 0 && (
              <Link
                href={`/map?drawZone=1&runwayId=${encodeURIComponent(runway.id)}`}
                className={cn("inline-flex h-8 items-center gap-1.5 px-3 text-[12px]", BTN_PRIMARY)}
              >
                <Layers size={13} strokeWidth={2} />
                Draw zone on map
              </Link>
            )}
          </div>
          {zonesLoading ? (
            <p className={cn("text-[13px]", MUTED)}>Loading zone…</p>
          ) : zones.length > 0 ? (
            <div className="space-y-3">
              {zones.length > 1 && (
                <p className="text-[12px] leading-relaxed text-[#b45309]">
                  This runway has {zones.length} zones but only one is allowed. Click{" "}
                  <span className="font-medium">Keep this zone</span> on the one you want — inspection
                  history from the others will move over automatically.
                </p>
              )}
              {zones.map((z) => (
                <ZoneRow
                  key={z.id}
                  zone={z}
                  onChanged={onZonesChanged}
                  multiZone={zones.length > 1}
                  onKeep={() => setPendingKeep(z)}
                  busy={zoneBusy}
                />
              ))}
            </div>
          ) : (
            <p className={cn("text-[13px]", MUTED)}>
              No zone drawn yet — use the button above to plot the runway boundary on the map.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#dbdfe3] pt-4">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() =>
              void act(() =>
                api.updateRunway(runway.id, {
                  name,
                  designation,
                  length,
                  mapStatus,
                }),
              )
            }
            className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          {!dirty && !err && (
            <span className={cn("text-[11px]", MUTED)}>No unsaved changes</span>
          )}
        </div>

        <div className="rounded-md border border-[#dbdfe3] bg-[#f3f5f7] p-4">
          <p className={EYEBROW}>Lifecycle</p>
          <p className={cn("mt-1 text-[12px] leading-relaxed", MUTED)}>
            Retire a runway to stop new passes without removing it from the list. Delete removes the runway config; inspection history is preserved.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api.updateRunway(runway.id, { activeStatus: retired ? "active" : "retired" }),
                )
              }
              className={cn("h-8 px-3 text-[12px]", BTN)}
            >
              {retired ? "Activate runway" : "Retire runway"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRequestDelete}
              className={cn("h-8 px-3 text-[12px]", BTN_DANGER)}
            >
              <Trash2 size={13} strokeWidth={2} />
              Delete runway
            </button>
          </div>
        </div>

        {err && <p className="text-[12px] font-medium text-[#b91c1c]">{err}</p>}
      </div>
    </Panel>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={METRIC_CELL}>
      <p className={EYEBROW}>{label}</p>
      <p className="mt-1 text-[18px] font-semibold tabular-nums text-[#181b1e]">{value}</p>
      <p className={cn("mt-0.5 text-[11px]", MUTED)}>{detail}</p>
    </div>
  );
}

function ZoneRow({
  zone,
  onChanged,
  multiZone,
  onKeep,
  busy: rowBusy,
}: {
  zone: Zone;
  onChanged: () => void;
  multiZone?: boolean;
  onKeep?: () => void;
  busy?: boolean;
}) {
  const [name, setName] = useState(zone.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const dirty = name !== zone.name;
  const disabled = busy || rowBusy;

  useEffect(() => {
    setName(zone.name);
  }, [zone.name]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(apiErrorMessage(e, "Action failed."));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteZone = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteZone(zone.id);
      setPendingDelete(false);
      onChanged();
    } catch (e) {
      setErr(apiErrorMessage(e, "Failed to delete zone."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 rounded-md border border-[#dbdfe3] bg-[#f3f5f7] p-3">
      {pendingDelete && (
        <ConfirmDeleteModal
          title="Delete zone"
          description="This removes the inspection zone from the map. Past inspection records are kept for reports and training."
          itemLabel={zone.name}
          onCancel={() => setPendingDelete(false)}
          onConfirm={confirmDeleteZone}
        />
      )}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          className={cn("h-8 min-w-0 flex-1 px-3 text-[13px]", INPUT)}
          aria-label={`Zone name for ${zone.id}`}
        />
        {dirty && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void act(() => api.updateZone(zone.id, { name: name.trim() }))}
            className={cn("h-8 shrink-0 px-3 text-[12px]", BTN_PRIMARY)}
          >
            Save
          </button>
        )}
        {multiZone && onKeep ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onKeep}
            className={cn("h-8 shrink-0 px-3 text-[12px]", BTN_PRIMARY)}
          >
            Keep this zone
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPendingDelete(true)}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#c7cdd2] text-[#5b6166] transition-colors",
              "hover:border-[#b91c1c] hover:bg-[#fbeae8] hover:text-[#b91c1c] disabled:opacity-40",
            )}
            aria-label={`Delete ${zone.name}`}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        )}
      </div>
      {err && <p className="text-[12px] font-medium text-[#b91c1c]">{err}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className={EYEBROW}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-8 w-full px-3 text-[12px]", INPUT)}
      />
    </div>
  );
}
