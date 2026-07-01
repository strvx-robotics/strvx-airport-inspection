"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Layers, Trash2 } from "lucide-react";
import Badge from "@/components/Badge";
import ConfirmDeleteModal from "@/components/ConfirmDeleteModal";
import LengthField from "@/components/LengthField";
import SelectMenu from "@/components/Select";
import * as api from "@/lib/api";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatLengthFt,
  MAP_STATUS_LABEL,
  mapStatusTone,
} from "@/lib/zoneAdmin";
import type { Boundary, Zone, ZoneMapStatus } from "@/lib/types";
import { ZONE_MAP_STATUSES } from "@/lib/types";
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

const MAP_STATUS_HELP: Record<ZoneMapStatus, string> = {
  draft: "Polygon defined but not yet approved for inspections.",
  active: "Current operational boundary used for zone placement.",
  retired: "Historical boundary — no longer used for new passes.",
  needs_review: "Boundary flagged for admin review before next pass.",
};

export default function AdminZonePage() {
  const { role } = useStore();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [zone, setZone] = useState<Zone | null>(null);
  const [boundaries, setBoundaries] = useState<Boundary[] | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const [pendingZoneDelete, setPendingZoneDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.getZone(id);
      setZone(detail.zone);
      setErr(null);
    } catch (e) {
      setZone(null);
      setErr(apiErrorMessage(e, "Zone not found."));
    }
  }, [id]);

  const loadBoundaries = useCallback(async () => {
    try {
      setBoundaries(await api.listBoundaries(id));
    } catch {
      setBoundaries([]);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadBoundaries();
  }, [load, loadBoundaries]);

  if (role !== "admin") {
    return (
      <Shell>
        <p className={cn("text-[13px]", MUTED)}>Switch to the Admin role to manage zones.</p>
      </Shell>
    );
  }

  if (!zone) {
    return (
      <Shell>
        <BackLink />
        <p className={cn("mt-4 text-[13px]", MUTED)}>{err ?? "Loading zone…"}</p>
      </Shell>
    );
  }

  const mapped = Boolean(zone.zonePolygon?.length);
  const mapTone = mapStatusTone(zone.mapStatus, mapped);
  const retired = zone.activeStatus === "retired";

  return (
    <Shell>
      {pendingZoneDelete && (
        <ConfirmDeleteModal
          title="Delete zone"
          description="This removes the zone from the airfield configuration. Past inspection records are kept for reports and training."
          itemLabel={`${zone.name} · ${zone.designation}`}
          onCancel={() => {
            if (!deleteBusy) setPendingZoneDelete(false);
          }}
          onConfirm={async () => {
            setDeleteBusy(true);
            setDeleteErr(null);
            try {
              await api.deleteZone(zone.id);
              setPendingZoneDelete(false);
              router.push("/admin?section=zones");
            } catch (e) {
              setDeleteErr(apiErrorMessage(e, "Failed to delete zone."));
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
            <p className={cn("mt-3", EYEBROW)}>Zone</p>
            <p className="mt-1 text-[14px] font-semibold text-[#181b1e]">{zone.name}</p>
            <p className={cn("mt-0.5 font-mono text-[12px]", MUTED)}>{zone.designation}</p>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={retired ? "gray" : "green"}>{zone.activeStatus ?? "active"}</Badge>
              <Badge tone={mapTone}>
                {mapped ? MAP_STATUS_LABEL[zone.mapStatus ?? "draft"] : "Unmapped"}
              </Badge>
            </div>
            <dl className="space-y-2 border-t border-[#dbdfe3] pt-3">
              <InfoRow label="Zone ID" value={zone.id} mono />
              {zone.length && <InfoRow label="Length" value={zone.length} />}
              <InfoRow
                label="Boundary"
                value={
                  boundaries === undefined
                    ? "…"
                    : boundaries.length === 0
                      ? "Not drawn"
                      : boundaries.length === 1
                        ? boundaries[0].name
                        : `${boundaries.length} — pick one`
                }
              />
            </dl>
          </div>
        </aside>

        <section className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", CARD)}>
          <div className={cn("border-b border-[#dfe4e8] px-5 py-3.5", BAR)}>
            <p className={EYEBROW}>Zone configuration</p>
            <p className="mt-1 text-[12px] text-[#5b6166]">
              Identity, map status, and the inspection boundary for this zone.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-8">
            <ZoneEditor
              zone={zone}
              boundaries={boundaries ?? []}
              boundariesLoading={boundaries === undefined}
              onSaved={async () => {
                await load();
              }}
              onBoundariesChanged={() => {
                void loadBoundaries();
              }}
              onRequestDelete={() => setPendingZoneDelete(true)}
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
              Draw the inspection boundary on the satellite map — not entered as coordinates here.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <dl className="space-y-3">
              {ZONE_MAP_STATUSES.map((s) => (
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
                <dt className="text-[12px] font-semibold text-[#181b1e]">Inspection boundary</dt>
                <dd className="text-[12px] leading-relaxed text-[#3f4448]">
                  Each zone has one boundary, drawn on the satellite map. Hover it on the map to edit or delete.
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[12px] font-semibold text-[#181b1e]">Delete vs retire</dt>
                <dd className="text-[12px] leading-relaxed text-[#3f4448]">
                  Delete removes zone or boundary configuration from the map and admin views.
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
      href="/admin?section=zones"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-[#c7cdd2] bg-[#fbfcfd] px-3 text-[12px] font-medium text-[#5b6166] transition-colors hover:border-[#a8afb5] hover:bg-[#eef1f4] hover:text-[#181b1e]",
        BTN,
      )}
    >
      <ChevronLeft size={14} strokeWidth={2} />
      Zones
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

function ZoneEditor({
  zone,
  boundaries,
  boundariesLoading,
  onSaved,
  onBoundariesChanged,
  onRequestDelete,
}: {
  zone: Zone;
  boundaries: Boundary[];
  boundariesLoading: boolean;
  onSaved: () => void | Promise<void>;
  onBoundariesChanged: () => void;
  onRequestDelete: () => void;
}) {
  const [name, setName] = useState(zone.name);
  const [designation, setDesignation] = useState(zone.designation);
  const [length, setLength] = useState(formatLengthFt(zone.length ?? ""));
  const [mapStatus, setMapStatus] = useState<ZoneMapStatus>(zone.mapStatus ?? "draft");
  const [busy, setBusy] = useState(false);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [pendingKeep, setPendingKeep] = useState<Boundary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(zone.name);
    setDesignation(zone.designation);
    setLength(formatLengthFt(zone.length ?? ""));
    setMapStatus(zone.mapStatus ?? "draft");
  }, [zone]);

  const mapped = Boolean(zone.zonePolygon?.length);
  const retired = zone.activeStatus === "retired";
  const dirty =
    name !== zone.name ||
    designation !== zone.designation ||
    length !== formatLengthFt(zone.length ?? "") ||
    mapStatus !== (zone.mapStatus ?? "draft");

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
      for (const b of boundaries.filter((x) => x.id !== keepId)) {
        await api.deleteBoundary(b.id, { reassignToBoundaryId: keepId });
      }
      setPendingKeep(null);
      onBoundariesChanged();
    } catch (e) {
      setErr(apiErrorMessage(e, "Failed to consolidate boundaries."));
    } finally {
      setZoneBusy(false);
    }
  };

  return (
    <Panel
      title="Zone details"
      desc="Name, designation, map status, and inspection boundary."
      action={
        <div className="flex flex-wrap gap-2">
          <Badge tone={retired ? "gray" : "green"}>{zone.activeStatus ?? "active"}</Badge>
          <Badge tone={mapStatusTone(mapStatus, mapped)}>
            {MAP_STATUS_LABEL[mapStatus]}
          </Badge>
        </div>
      }
    >
      <div className="space-y-5">
        {pendingKeep && (
          <ConfirmDeleteModal
            title="Keep this boundary"
            description={`Remove ${boundaries.length - 1} other boundar${boundaries.length === 2 ? "y" : "ies"} from this zone. Any inspection history on removed boundaries will move to "${pendingKeep.name}".`}
            itemLabel={pendingKeep.name}
            confirmLabel="Keep this boundary"
            onCancel={() => {
              if (!zoneBusy) setPendingKeep(null);
            }}
            onConfirm={() => keepOnlyZone(pendingKeep.id)}
          />
        )}
        <div className="grid gap-px overflow-hidden rounded-md border border-[#dbdfe3] bg-[#dbdfe3] sm:grid-cols-2">
          <Metric label="Designation" value={zone.designation} detail="threshold pair" />
          <Metric label="Length" value={zone.length || "—"} detail="published length" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Designation" value={designation} onChange={setDesignation} />
          <LengthField label="Length" value={length} onChange={setLength} placeholder="7,000 ft" />
          <div className="space-y-1">
            <label className={EYEBROW}>Map status</label>
            <SelectMenu
              value={mapStatus}
              options={ZONE_MAP_STATUSES.map((s) => ({ value: s, label: MAP_STATUS_LABEL[s] }))}
              onChange={(v) => setMapStatus(v as ZoneMapStatus)}
              ariaLabel="Map status"
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-[#dbdfe3] pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={EYEBROW}>Inspection boundary</p>
              <p className={cn("mt-0.5 text-[12px]", MUTED)}>
                One boundary per zone — plot on the satellite map.
              </p>
            </div>
            {!boundariesLoading && boundaries.length === 0 && (
              <Link
                href={`/map?drawZone=1&zoneId=${encodeURIComponent(zone.id)}`}
                className={cn("inline-flex h-8 items-center gap-1.5 px-3 text-[12px]", BTN_PRIMARY)}
              >
                <Layers size={13} strokeWidth={2} />
                Draw boundary on map
              </Link>
            )}
          </div>
          {boundariesLoading ? (
            <p className={cn("text-[13px]", MUTED)}>Loading boundary…</p>
          ) : boundaries.length > 0 ? (
            <div className="space-y-3">
              {boundaries.length > 1 && (
                <p className="text-[12px] leading-relaxed text-[#b45309]">
                  This zone has {boundaries.length} boundaries but only one is allowed. Click{" "}
                  <span className="font-medium">Keep this boundary</span> on the one you want — inspection
                  history from the others will move over automatically.
                </p>
              )}
              {boundaries.map((b) => (
                <BoundaryRow
                  key={b.id}
                  boundary={b}
                  onChanged={onBoundariesChanged}
                  multiBoundary={boundaries.length > 1}
                  onKeep={() => setPendingKeep(b)}
                  busy={zoneBusy}
                />
              ))}
            </div>
          ) : (
            <p className={cn("text-[13px]", MUTED)}>
              No boundary drawn yet — use the button above to plot the zone boundary on the map.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#dbdfe3] pt-4">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() =>
              void act(() =>
                api.updateZone(zone.id, {
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
            Retire a zone to stop new passes without removing it from the list. Delete removes the zone config; inspection history is preserved.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api.updateZone(zone.id, { activeStatus: retired ? "active" : "retired" }),
                )
              }
              className={cn("h-8 px-3 text-[12px]", BTN)}
            >
              {retired ? "Activate zone" : "Retire zone"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRequestDelete}
              className={cn("h-8 px-3 text-[12px]", BTN_DANGER)}
            >
              <Trash2 size={13} strokeWidth={2} />
              Delete zone
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

function BoundaryRow({
  boundary,
  onChanged,
  multiBoundary,
  onKeep,
  busy: rowBusy,
}: {
  boundary: Boundary;
  onChanged: () => void;
  multiBoundary?: boolean;
  onKeep?: () => void;
  busy?: boolean;
}) {
  const [name, setName] = useState(boundary.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const dirty = name !== boundary.name;
  const disabled = busy || rowBusy;

  useEffect(() => {
    setName(boundary.name);
  }, [boundary.name]);

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

  const confirmDeleteBoundary = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteBoundary(boundary.id);
      setPendingDelete(false);
      onChanged();
    } catch (e) {
      setErr(apiErrorMessage(e, "Failed to delete boundary."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 rounded-md border border-[#dbdfe3] bg-[#f3f5f7] p-3">
      {pendingDelete && (
        <ConfirmDeleteModal
          title="Delete boundary"
          description="This removes the inspection boundary from the map. Past inspection records are kept for reports and training."
          itemLabel={boundary.name}
          onCancel={() => setPendingDelete(false)}
          onConfirm={confirmDeleteBoundary}
        />
      )}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          className={cn("h-8 min-w-0 flex-1 px-3 text-[13px]", INPUT)}
          aria-label={`Boundary name for ${boundary.id}`}
        />
        {dirty && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void act(() => api.updateBoundary(boundary.id, { name: name.trim() }))}
            className={cn("h-8 shrink-0 px-3 text-[12px]", BTN_PRIMARY)}
          >
            Save
          </button>
        )}
        {multiBoundary && onKeep ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onKeep}
            className={cn("h-8 shrink-0 px-3 text-[12px]", BTN_PRIMARY)}
          >
            Keep this boundary
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
            aria-label={`Delete ${boundary.name}`}
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
