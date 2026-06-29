"use client";

import { useCallback, useEffect, useState } from "react";
import SelectMenu from "@/components/Select";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import {
  Cog,
  Play,
  FileText,
  FileJson,
  FileSpreadsheet,
  Download,
  Building2,
  Users,
  Route,
  CalendarClock,
  Database,
  type LucideIcon,
} from "lucide-react";
import Badge, { type Tone } from "@/components/Badge";
import { useOverview, useStore } from "@/lib/store";
import * as api from "@/lib/api";
import { INSPECTION_TYPE, INSPECTION_WINDOW, ROLE } from "@/lib/ui";
import { INSPECTION_TYPES, INSPECTION_WINDOWS, RUNWAY_MAP_STATUSES } from "@/lib/types";
import type {
  Airport,
  InspectionSchedule,
  InspectionType,
  InspectionWindow,
  LngLat,
  RunwayMapStatus,
  User,
  UserRole,
  Zone,
} from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  PAGE,
  CARD,
  BAR,
  INPUT,
  BTN,
  BTN_PRIMARY,
  EYEBROW,
  H2,
  MUTED,
} from "@/lib/vstyle";

type RunwayLite = {
  id: string;
  name: string;
  designation: string;
  length: string;
  runwayPolygon?: LngLat[];
  mapStatus?: RunwayMapStatus;
  activeStatus?: string;
};
const MAP_STATUS_LABEL: Record<RunwayMapStatus, string> = {
  draft: "Draft map",
  active: "Active map",
  retired: "Retired map",
  needs_review: "Needs review",
};

const SECTIONS: { id: string; label: string; icon: LucideIcon; desc: string }[] = [
  { id: "general", label: "General", icon: Building2, desc: "General information for this airfield." },
  { id: "users", label: "Users & access", icon: Users, desc: "People with access and the role that governs what they can do." },
  { id: "runways", label: "Runways & zones", icon: Route, desc: "Runways under inspection and the zones defined along each." },
  { id: "schedule", label: "Schedule", icon: CalendarClock, desc: "Automated inspection passes and their illumination window." },
  { id: "data", label: "Data & export", icon: Database, desc: "Run a pass on demand, export reports and learning data." },
];

export default function AdminPage() {
  const { role } = useStore();
  const { overview, refresh } = useOverview();
  const [active, setActive] = useState<string>("general");

  if (role !== "admin") {
    return (
      <Shell>
        <div className={cn("rounded-md px-4 py-3 text-[13px]", CARD, MUTED)}>
          Switch to the Admin role to manage settings, users, and schedules.
        </div>
      </Shell>
    );
  }

  const airport = overview?.airport;
  const inspectionId = overview?.inspection?.id;
  const runways: RunwayLite[] = overview?.runways.map((r) => r.runway) ?? [];
  const reload = () => void refresh();

  return (
    <Shell subtitle={airport ? `${airport.name} · ${airport.code}` : undefined}>
      <div className="mt-6 grid gap-6 md:grid-cols-[210px_1fr]">
        {/* section menu */}
        <nav className="flex flex-col gap-0.5 md:sticky md:top-6 md:self-start">
          {SECTIONS.map((s) => (
            <NavItem
              key={s.id}
              icon={s.icon}
              label={s.label}
              active={active === s.id}
              onClick={() => setActive(s.id)}
            />
          ))}
        </nav>

        {/* active section */}
        <div className="min-w-0 space-y-6">
          {active === "general" && <GeneralSection airport={airport} onSaved={reload} />}
          {active === "users" && <UsersSection />}
          {active === "runways" && airport && (
            <RunwaysSection airportId={airport.id} runways={runways} onDone={reload} />
          )}
          {active === "schedule" && airport && (
            <ScheduleSection airportId={airport.id} onDone={reload} />
          )}
          {active === "data" && <DataSection inspectionId={inspectionId} onRan={reload} />}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className={cn("min-h-full px-6 py-6", PAGE)}>
      <div className="mx-auto max-w-6xl">
        <div>
          <p className={EYEBROW}>Valanor · Configuration</p>
          <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
            <Cog size={17} strokeWidth={2} /> Settings
          </h1>
          <p className={cn("mt-1 text-[13px]", MUTED)}>
            {subtitle ?? "Manage the inspection program, users, and data."}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors",
        active
          ? "bg-[#fbfcfd] font-medium text-[#181b1e] ring-1 ring-inset ring-[#dbdfe3]"
          : "text-[#5b6166] hover:bg-[#e4e8ec] hover:text-[#181b1e]",
      )}
    >
      <Icon
        size={15}
        strokeWidth={2}
        className={active ? "text-[#181b1e]" : "text-[#9aa1a6]"}
      />
      {label}
    </button>
  );
}

// ── Section panel + field display ─────────────────────────────────────────────

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

// ── General ───────────────────────────────────────────────────────────────────
// Single airport per deployment, so this edits the one airfield's identity in
// place rather than creating airports.

function GeneralSection({ airport, onSaved }: { airport?: Airport; onSaved: () => void }) {
  if (!airport) {
    return (
      <Panel title="General" desc={SECTIONS[0].desc}>
        <p className={cn("text-[13px]", MUTED)}>Loading…</p>
      </Panel>
    );
  }
  // key on id so the form re-seeds if the airfield ever changes underneath us.
  return <GeneralForm key={airport.id} airport={airport} onSaved={onSaved} />;
}

function GeneralForm({ airport, onSaved }: { airport: Airport; onSaved: () => void }) {
  const [name, setName] = useState(airport.name);
  const [code, setCode] = useState(airport.code);
  const [location, setLocation] = useState(airport.location);
  const [timezone, setTimezone] = useState(airport.timezone);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");

  const dirty =
    name !== airport.name ||
    code !== airport.code ||
    location !== airport.location ||
    timezone !== airport.timezone;

  const save = async () => {
    setBusy(true);
    setStatus("idle");
    try {
      await api.updateAirport(airport.id, { name, code, location, timezone });
      setStatus("ok");
      onSaved();
    } catch {
      setStatus("err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="General" desc={SECTIONS[0].desc}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Airport name" value={name} onChange={setName} placeholder="Augusta Regional" />
          <Input label="Code" value={code} onChange={setCode} placeholder="AGS" />
          <Input label="Location" value={location} onChange={setLocation} placeholder="Augusta, GA" />
          <Input label="Timezone" value={timezone} onChange={setTimezone} placeholder="America/New_York" />
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={!name || !code || !dirty || busy}
            onClick={save}
            className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          {status === "ok" && <span className="font-mono text-[11px] text-[#5b6166]">Saved.</span>}
          {status === "err" && (
            <span className="font-mono text-[11px] font-semibold text-[#181b1e]">Failed.</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ── Users & access ────────────────────────────────────────────────────────────

const ROLE_TONE: Record<UserRole, Tone> = {
  admin: "black",
  inspector: "blue",
  maintenance: "purple",
};
const ROLE_ACCESS: Record<UserRole, string> = {
  admin: "Full access — configuration, runways, schedules, and data export.",
  inspector: "Reviews detections, approves or rejects issues, runs live passes.",
  maintenance: "Work orders only — repairs and closes assigned tickets.",
};

const userColumns: DataTableColumn<User>[] = [
  {
    colId: "name",
    headerName: "Name",
    field: "name",
    cellClass: "text-[13px] text-[#181b1e]",
    flex: 1,
    minWidth: 180,
  },
  {
    colId: "username",
    headerName: "Username",
    field: "username",
    cellClass: "font-mono text-[12px] text-[#5b6166]",
    flex: 1,
    minWidth: 160,
  },
  {
    colId: "role",
    headerName: "Role",
    field: "role",
    cellRenderer: ({ data }: { data?: User }) =>
      data ? <Badge tone={ROLE_TONE[data.role]}>{ROLE[data.role]}</Badge> : null,
    minWidth: 150,
  },
];

const runwayColumns: DataTableColumn<RunwayLite>[] = [
  {
    colId: "name",
    headerName: "Name",
    field: "name",
    cellClass: "text-[13px] text-[#181b1e]",
    flex: 1,
    minWidth: 150,
  },
  {
    colId: "designation",
    headerName: "Designation",
    field: "designation",
    cellClass: "font-mono text-[12px] text-[#3f4448]",
    minWidth: 140,
  },
  {
    colId: "length",
    headerName: "Length",
    valueGetter: ({ data }) => data?.length || "-",
    cellClass: "font-mono text-[12px] text-[#5b6166]",
    minWidth: 120,
  },
  {
    colId: "map",
    headerName: "Map",
    valueGetter: ({ data }) =>
      data?.runwayPolygon?.length ? MAP_STATUS_LABEL[data.mapStatus ?? "draft"] : "Unmapped",
    cellRenderer: ({ data }: { data?: RunwayLite }) => {
      if (!data) return null;
      const tone = data.mapStatus === "active" ? "green" : data.mapStatus === "needs_review" ? "amber" : "gray";
      return (
        <Badge tone={tone}>
          {data.runwayPolygon?.length ? MAP_STATUS_LABEL[data.mapStatus ?? "draft"] : "Unmapped"}
        </Badge>
      );
    },
    minWidth: 150,
  },
  {
    colId: "status",
    headerName: "Status",
    valueGetter: ({ data }) => data?.activeStatus ?? "-",
    cellRenderer: ({ data }: { data?: RunwayLite }) =>
      data ? (
        <Badge tone={data.activeStatus === "active" ? "green" : "gray"}>
          {data.activeStatus ?? "-"}
        </Badge>
      ) : null,
    minWidth: 140,
  },
];

function UsersSection() {
  const [users, setUsers] = useState<User[] | undefined>();
  useEffect(() => {
    let live = true;
    api
      .listUsers()
      .then((u) => live && setUsers(u))
      .catch(() => live && setUsers([]));
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <Panel
        title="Users & access"
        desc={SECTIONS[1].desc}
        action={
          users && (
            <span className={cn("whitespace-nowrap text-[12px]", MUTED)}>
              {users.length} member{users.length === 1 ? "" : "s"}
            </span>
          )
        }
      >
        {!users ? (
          <p className={cn("text-[13px]", MUTED)}>Loading members…</p>
        ) : users.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>No users.</p>
        ) : (
          <DataTable
            rows={users}
            columns={userColumns}
            label="Users and access"
            height={260}
            getRowId={(u) => u.id}
          />
        )}
      </Panel>

      <Panel title="Access levels" desc="What each role can do. Switch the active demo role from the avatar menu.">
        <dl className="space-y-3">
          {(Object.keys(ROLE_ACCESS) as UserRole[]).map((r) => (
            <div key={r} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <dt className="w-28 shrink-0">
                <Badge tone={ROLE_TONE[r]}>{ROLE[r]}</Badge>
              </dt>
              <dd className="text-[13px] text-[#3f4448]">{ROLE_ACCESS[r]}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}

// ── Runways & zones ───────────────────────────────────────────────────────────

function RunwaysSection({
  airportId,
  runways,
  onDone,
}: {
  airportId: string;
  runways: RunwayLite[];
  onDone: () => void;
}) {
  return (
    <>
      <Panel
        title="Runways"
        desc={SECTIONS[2].desc}
        action={
          <span className={cn("whitespace-nowrap text-[12px]", MUTED)}>
            {runways.length} runway{runways.length === 1 ? "" : "s"}
          </span>
        }
      >
        {runways.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>No runways yet.</p>
        ) : (
          <DataTable
            rows={runways}
            columns={runwayColumns}
            label="Runways"
            height={320}
            getRowId={(r) => r.id}
          />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Add runway" desc="Define a runway and its threshold designation.">
          <RunwayForm airportId={airportId} onDone={onDone} />
        </Panel>
        <Panel title="Add zone" desc="Carve an inspection zone along a runway.">
          <ZoneForm runways={runways} onDone={onDone} />
        </Panel>
      </div>

      <Panel
        title="Manage runways & zones"
        desc="Rename, retire, or delete. Delete is blocked once a runway/zone has inspection data — retire it instead."
      >
        {runways.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>No runways yet.</p>
        ) : (
          <ul className="divide-y divide-[#dbdfe3]">
            {runways.map((r) => (
              <RunwayManageRow key={r.id} runway={r} onDone={onDone} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function RunwayManageRow({ runway, onDone }: { runway: RunwayLite; onDone: () => void }) {
  const [name, setName] = useState(runway.name);
  const [designation, setDesignation] = useState(runway.designation);
  const [length, setLength] = useState(runway.length ?? "");
  const [zones, setZones] = useState<Zone[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const retired = runway.activeStatus === "retired";
  const dirty =
    name !== runway.name || designation !== runway.designation || length !== (runway.length ?? "");

  const loadZones = useCallback(() => {
    api.listZones(runway.id).then(setZones).catch(() => setZones([]));
  }, [runway.id]);
  useEffect(() => {
    loadZones();
  }, [loadZones]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-2 py-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input label="Name" value={name} onChange={setName} />
        <Input label="Designation" value={designation} onChange={setDesignation} />
        <Input label="Length" value={length} onChange={setLength} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void act(() => api.updateRunway(runway.id, { name, designation, length }))}
          disabled={!dirty || busy}
          className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN_PRIMARY)}
        >
          Save
        </button>
        <button
          onClick={() =>
            void act(() =>
              api.updateRunway(runway.id, { activeStatus: retired ? "active" : "retired" }),
            )
          }
          disabled={busy}
          className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN)}
        >
          {retired ? "Activate" : "Retire"}
        </button>
        <button
          onClick={() => void act(() => api.deleteRunway(runway.id))}
          disabled={busy}
          className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN)}
        >
          Delete
        </button>
        <Badge tone={retired ? "gray" : "green"}>{runway.activeStatus ?? "active"}</Badge>
      </div>

      <div className="rounded-md border border-[#dbdfe3] bg-[#fbfcfd] p-2.5">
        <p className={EYEBROW}>Zones</p>
        {!zones ? (
          <p className={cn("mt-1 text-[12px]", MUTED)}>Loading…</p>
        ) : zones.length === 0 ? (
          <p className={cn("mt-1 text-[12px]", MUTED)}>No zones on this runway.</p>
        ) : (
          <ul className="mt-1 divide-y divide-[#eef1f4]">
            {zones.map((z) => (
              <ZoneManageRow
                key={z.id}
                zone={z}
                onDone={() => {
                  loadZones();
                  onDone();
                }}
              />
            ))}
          </ul>
        )}
      </div>
      {err && <p className="text-[12px] font-medium text-[#b91c1c]">{err}</p>}
    </li>
  );
}

function ZoneManageRow({ zone, onDone }: { zone: Zone; onDone: () => void }) {
  const [name, setName] = useState(zone.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = name !== zone.name;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={cn("h-8 min-w-0 flex-1 px-2.5 text-[12px]", INPUT)}
      />
      <button
        onClick={() => void act(() => api.updateZone(zone.id, { name }))}
        disabled={!dirty || busy}
        className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN)}
      >
        Save
      </button>
      <button
        onClick={() => void act(() => api.deleteZone(zone.id))}
        disabled={busy}
        className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN)}
      >
        Delete
      </button>
      {err && <span className="w-full text-[11px] font-medium text-[#b91c1c]">{err}</span>}
    </li>
  );
}

function RunwayForm({ airportId, onDone }: { airportId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [length, setLength] = useState("");
  const [mapStatus, setMapStatus] = useState<RunwayMapStatus>("draft");
  const [polygonText, setPolygonText] = useState("");
  const polygon = parsePolygon(polygonText);
  const polygonInvalid = polygonText.trim().length > 0 && polygon === undefined;
  return (
    <FormShell
      disabled={!name || !designation || polygonInvalid}
      reset={() => {
        setName("");
        setDesignation("");
        setLength("");
        setMapStatus("draft");
        setPolygonText("");
      }}
      submit={async () => {
        await api.createRunway({
          airportId,
          name,
          designation,
          length: length || undefined,
          runwayPolygon: polygon,
          mapStatus,
        });
        onDone();
      }}
    >
      <Input label="Name" value={name} onChange={setName} placeholder="Runway 4" />
      <Input label="Designation" value={designation} onChange={setDesignation} placeholder="14 – 32" />
      <Input label="Length" value={length} onChange={setLength} placeholder="7,000 ft" />
      <Select
        label="Map status"
        value={mapStatus}
        onChange={(v) => setMapStatus(v as RunwayMapStatus)}
        options={RUNWAY_MAP_STATUSES.map((s) => ({ value: s, label: MAP_STATUS_LABEL[s] }))}
      />
      <TextArea
        label="Manual runway polygon"
        value={polygonText}
        onChange={setPolygonText}
        placeholder='[{"lat":33.371,"lng":-81.967},{"lat":33.372,"lng":-81.965},{"lat":33.370,"lng":-81.964}]'
      />
      <p className={cn("text-[11px] leading-relaxed", polygonInvalid ? "text-[#181b1e]" : MUTED)}>
        Drawn runway geometry is the source of truth for map placement. Enter at least three lat/lng points as JSON for now; the drawing tool will write this same field.
      </p>
    </FormShell>
  );
}

function parsePolygon(raw: string): LngLat[] | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length < 3) return undefined;
    const points = parsed.map((p) => {
      if (
        !p ||
        typeof p !== "object" ||
        typeof (p as LngLat).lat !== "number" ||
        typeof (p as LngLat).lng !== "number"
      ) {
        throw new Error("bad point");
      }
      return { lat: (p as LngLat).lat, lng: (p as LngLat).lng };
    });
    return points;
  } catch {
    return undefined;
  }
}

function ZoneForm({
  runways,
  onDone,
}: {
  runways: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [runwayId, setRunwayId] = useState("");
  const [name, setName] = useState("");
  const selected = runwayId || runways[0]?.id || "";
  return (
    <FormShell
      disabled={!selected || !name}
      reset={() => setName("")}
      submit={async () => {
        await api.createZone({ runwayId: selected, name });
        setName("");
        onDone();
      }}
    >
      <Select
        label="Runway"
        value={selected}
        onChange={setRunwayId}
        options={runways.map((r) => ({ value: r.id, label: r.name }))}
      />
      <Input label="Name" value={name} onChange={setName} placeholder="Zone C · rollout" />
    </FormShell>
  );
}

// ── Schedule ──────────────────────────────────────────────────────────────────

function ScheduleSection({ airportId, onDone }: { airportId: string; onDone: () => void }) {
  const [schedules, setSchedules] = useState<InspectionSchedule[] | undefined>();
  const load = useCallback(() => {
    api.listSchedules(airportId).then(setSchedules).catch(() => setSchedules([]));
  }, [airportId]);
  useEffect(() => {
    load();
  }, [load]);
  const reload = () => {
    load();
    onDone();
  };
  return (
    <>
      <Panel
        title="Schedule"
        desc={SECTIONS[3].desc}
        action={
          schedules && (
            <span className={cn("whitespace-nowrap text-[12px]", MUTED)}>
              {schedules.length} schedule{schedules.length === 1 ? "" : "s"}
            </span>
          )
        }
      >
        {!schedules ? (
          <p className={cn("text-[13px]", MUTED)}>Loading schedules…</p>
        ) : schedules.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>No schedules yet.</p>
        ) : (
          <ul className="divide-y divide-[#dbdfe3]">
            {schedules.map((s) => (
              <ScheduleRow key={s.id} schedule={s} onChanged={reload} />
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Add schedule" desc="Add a recurring inspection pass and its illumination window.">
        <ScheduleForm airportId={airportId} onDone={reload} />
      </Panel>
    </>
  );
}

function ScheduleRow({
  schedule,
  onChanged,
}: {
  schedule: InspectionSchedule;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="flex items-center gap-2 text-[13px] text-[#181b1e]">
        <span className="font-mono">{schedule.time}</span>
        <span className={cn("text-[12px]", MUTED)}>{INSPECTION_WINDOW[schedule.window]}</span>
        <Badge tone={schedule.enabled ? "green" : "gray"}>
          {schedule.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </span>
      <span className="flex gap-2">
        <button
          onClick={() => void act(() => api.updateSchedule(schedule.id, { enabled: !schedule.enabled }))}
          disabled={busy}
          className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN)}
        >
          {schedule.enabled ? "Disable" : "Enable"}
        </button>
        <button
          onClick={() => void act(() => api.deleteSchedule(schedule.id))}
          disabled={busy}
          className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN)}
        >
          Delete
        </button>
      </span>
    </li>
  );
}

function ScheduleForm({ airportId, onDone }: { airportId: string; onDone: () => void }) {
  const [time, setTime] = useState("06:00");
  const [win, setWin] = useState<InspectionWindow>("daylight");
  const [enabled, setEnabled] = useState(true);
  return (
    <FormShell
      disabled={!time}
      reset={() => {
        setTime("06:00");
        setEnabled(true);
      }}
      submit={async () => {
        await api.createSchedule({ airportId, time, window: win, enabled });
        onDone();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Time" value={time} onChange={setTime} placeholder="06:00" />
        <Select
          label="Window"
          value={win}
          onChange={(v) => setWin(v as InspectionWindow)}
          options={INSPECTION_WINDOWS.map((w) => ({ value: w, label: INSPECTION_WINDOW[w] }))}
        />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-[#3f4448]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3.5 w-3.5 accent-[#181b1e]"
        />
        Enabled — run this pass automatically at the scheduled time.
      </label>
    </FormShell>
  );
}

// ── Data & export ─────────────────────────────────────────────────────────────

function DataSection({ inspectionId, onRan }: { inspectionId?: string; onRan: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [type, setType] = useState<InspectionType>("daily");
  const [reason, setReason] = useState("");

  const runNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const insp = await api.runInspectionNow(
        type,
        type === "daily" ? undefined : reason.trim() || undefined,
      );
      setMsg(`Started ${INSPECTION_TYPE[type].label.toLowerCase()} inspection ${insp.id}.`);
      setReason("");
      onRan();
    } catch {
      setMsg("Run failed — is the API running?");
    } finally {
      setBusy(false);
    }
  };

  const exportFeedback = async () => {
    try {
      const jsonl = await api.exportFeedbackJsonl();
      downloadText(jsonl, "strvx-feedback.jsonl", "application/jsonl");
    } catch {
      setMsg("Export failed.");
    }
  };

  return (
    <Panel title="Data & export" desc={SECTIONS[4].desc}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Inspection type"
            value={type}
            onChange={(v) => setType(v as InspectionType)}
            options={INSPECTION_TYPES.map((t) => ({ value: t, label: INSPECTION_TYPE[t].label }))}
          />
          {type !== "daily" && (
            <Input
              label="Reason / context"
              value={reason}
              onChange={setReason}
              placeholder="e.g. high winds, reported FOD"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={runNow} disabled={busy} className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}>
            <Play size={13} strokeWidth={2} />
            {busy ? "Starting…" : `Start ${INSPECTION_TYPE[type].label.toLowerCase()} inspection`}
          </button>
          <button onClick={exportFeedback} className={cn("h-8 px-3 text-[12px]", BTN)}>
            <Download size={13} strokeWidth={2} /> Export feedback (JSONL)
          </button>
          {inspectionId && (
            <>
              <a
                href={api.reportUrl(inspectionId, "html")}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("h-8 px-3 text-[12px]", BTN)}
              >
                <FileText size={13} strokeWidth={2} /> Report (PDF)
              </a>
              <a
                href={api.reportUrl(inspectionId, "csv")}
                className={cn("h-8 px-3 text-[12px]", BTN)}
              >
                <FileSpreadsheet size={13} strokeWidth={2} /> Report (CSV)
              </a>
              <a
                href={api.reportUrl(inspectionId, "json")}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("h-8 px-3 text-[12px]", BTN)}
              >
                <FileJson size={13} strokeWidth={2} /> Report (JSON)
              </a>
            </>
          )}
        </div>
        {msg && <p className={cn("text-[12px]", MUTED)}>{msg}</p>}
      </div>
    </Panel>
  );
}

// ── Small form primitives (Valanor workspace look) ────────────────────────────

function FormShell({
  children,
  submit,
  reset,
  disabled,
}: {
  children: React.ReactNode;
  submit: () => Promise<void>;
  reset: () => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <div className="space-y-4">
      {children}
      <div className="flex items-center gap-2">
        <button
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true);
            setOk(false);
            setErr(false);
            try {
              await submit();
              setOk(true);
              reset();
            } catch {
              setErr(true);
            } finally {
              setBusy(false);
            }
          }}
          className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
        >
          {busy ? "Saving…" : "Create"}
        </button>
        {ok && <span className="font-mono text-[11px] text-[#5b6166]">Saved.</span>}
        {err && <span className="font-mono text-[11px] font-semibold text-[#181b1e]">Failed.</span>}
      </div>
    </div>
  );
}

function Input({
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
        className={cn("h-8 w-full px-3", INPUT)}
      />
    </div>
  );
}

function TextArea({
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
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={5}
        className={cn("w-full resize-y px-3 py-2 font-mono text-[11px]", INPUT)}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className={EYEBROW}>{label}</label>
      <SelectMenu value={value} options={options} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function downloadText(text: string, filename: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
