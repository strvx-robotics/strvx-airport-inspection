"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SelectMenu from "@/components/Select";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import {
  FileText,
  FileJson,
  FileSpreadsheet,
  Download,
  Building2,
  Users,
  Route,
  CalendarClock,
  Database,
  Trash2,
  UserPlus,
  Plus,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import Badge, { type Tone } from "@/components/Badge";
import ConfirmDeleteModal from "@/components/ConfirmDeleteModal";
import ExportPreviewModal, { type ExportFormat } from "@/components/ExportPreviewModal";
import AirportSearchSelect from "@/components/AirportSearchSelect";
import { useOverview, useStore } from "@/lib/store";
import { loadUsAirports, matchUsAirport, type UsAirportRef } from "@/lib/usAirports";
import * as api from "@/lib/api";
import { apiErrorMessage, type Overview } from "@/lib/api";
import { INSPECTION_STATUS, INSPECTION_TYPE, INSPECTION_WINDOW, ROLE, SCHEDULE_FREQUENCY } from "@/lib/ui";
import { fmtInTz } from "@/lib/format";
import { MAP_STATUS_LABEL, mapStatusTone } from "@/lib/runwayAdmin";
import {
  INSPECTION_WINDOWS,
  PERIODIC_FREQUENCIES,
  RUNWAY_MAP_STATUSES,
  USER_ROLES,
} from "@/lib/types";
import type {
  Airport,
  Inspection,
  InspectionSchedule,
  InspectionWindow,
  LngLat,
  RunwayMapStatus,
  ScheduleFrequency,
  ScheduleInspectionType,
  User,
  UserRole,
} from "@/lib/types";
import { SURVEILLANCE_TEMPLATES } from "@/lib/surveillanceTemplates";
import { cn } from "@/lib/cn";
import { isValidScheduleTime } from "@/lib/scheduleTime";
import {
  PAGE,
  CARD,
  BAR,
  INPUT,
  BTN,
  BTN_PRIMARY,
  EYEBROW,
  MUTED,
  METRIC_CELL,
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

const SECTIONS = [
  { id: "general", label: "General", icon: Building2, desc: "General information for this airfield." },
  { id: "users", label: "Users & access", icon: Users, desc: "People with access and the role that governs what they can do." },
  { id: "runways", label: "Runways & zones", icon: Route, desc: "Runways under inspection and the zones defined along each." },
  { id: "schedule", label: "Schedule", icon: CalendarClock, desc: "Daily self-inspection passes and periodic surveillance cadence." },
  { id: "data", label: "Data & export", icon: Database, desc: "Export reports from scheduled inspection passes." },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: LucideIcon; desc: string }>;

type SectionId = (typeof SECTIONS)[number]["id"];
type SidebarInfo = { title: string; desc?: string; body: React.ReactNode };

function isSectionId(value: string | null): value is SectionId {
  return typeof value === "string" && SECTIONS.some((section) => section.id === value);
}

export default function AdminPage() {
  const { role } = useStore();
  const { overview, refresh } = useOverview();
  const [active, setActive] = useState<SectionId>("general");

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (isSectionId(section)) setActive(section);
  }, []);

  const selectSection = (id: SectionId) => {
    setActive(id);
    const url = id === "general" ? "/admin" : `/admin?section=${id}`;
    window.history.replaceState(null, "", url);
  };

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
  const runways: RunwayLite[] = overview?.runways.map((r) => r.runway) ?? [];
  const reload = () => void refresh();

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <Shell>
      <div className="grid h-full min-h-0 flex-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)_280px] lg:items-stretch">
        <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden lg:sticky lg:top-0 lg:self-stretch", CARD)}>
          <div className={cn("border-b border-[#dfe4e8] px-4 py-3", BAR)}>
            <p className={EYEBROW}>Configuration</p>
            <p className="mt-1 text-[12px] text-[#5b6166]">Pick a section to edit the airport setup.</p>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-2">
            {SECTIONS.map((s) => (
              <NavItem
                key={s.id}
                icon={s.icon}
                label={s.label}
                active={active === s.id}
                onClick={() => selectSection(s.id)}
              />
            ))}
          </nav>
        </aside>

        <section className={cn("h-full min-h-0 min-w-0 overflow-hidden", CARD, "flex flex-col")}>
          <div className={cn("border-b border-[#dfe4e8] px-5 py-3.5", BAR)}>
            <p className={EYEBROW}>{section.label}</p>
            <p className="mt-1 text-[12px] text-[#5b6166]">{section.desc}</p>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-5 pb-8",
              active === "users" || active === "runways" ? "flex flex-col" : undefined,
            )}
          >
            <div
              className={cn(
                "space-y-6",
                (active === "users" || active === "runways") && "flex min-h-0 flex-1 flex-col",
              )}
            >
              {active === "general" && (
                <GeneralSection airport={airport} overview={overview} onSaved={reload} />
              )}
              {active === "users" && <UsersSection airportId={airport?.id} />}
              {active === "runways" && airport && (
                <RunwaysSection airportId={airport.id} runways={runways} onDone={reload} />
              )}
              {active === "schedule" && airport && (
                <ScheduleSection airportId={airport.id} onDone={reload} />
              )}
              {active === "data" && (
                <DataSection
                  inspections={overview?.inspections ?? []}
                  airport={airport}
                  defaultInspectionId={overview?.inspection?.id}
                />
              )}
            </div>
          </div>
        </section>

        <InfoSidebar sectionId={active} overview={overview} airport={airport} />
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

function InfoSidebar({
  sectionId,
  overview,
  airport,
}: {
  sectionId: SectionId;
  overview?: Overview;
  airport?: Airport;
}) {
  const info: SidebarInfo =
    sectionId === "general"
      ? {
          title: "Setup & reference",
          desc: "Checklist for a complete inspection program, plus field definitions.",
          body: airport ? (
            <GeneralInfoPanel overview={overview} airport={airport} />
          ) : (
            <p className={cn("text-[13px]", MUTED)}>Loading airport setup…</p>
          ),
        }
      : SECTION_INFO[sectionId];
  return (
    <aside
      className={cn(
        "h-full min-h-0 lg:sticky lg:top-0 lg:self-stretch",
        CARD,
        "flex flex-col overflow-hidden",
      )}
    >
      <div className={cn("border-b border-[#dfe4e8] px-4 py-3", BAR)}>
        <p className={EYEBROW}>{info.title}</p>
        {info.desc && <p className="mt-1 text-[12px] text-[#5b6166]">{info.desc}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{info.body}</div>
    </aside>
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
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors",
        active
          ? "bg-[#181b1e] font-medium text-[#fbfcfd] shadow-sm"
          : "text-[#5b6166] hover:bg-[#eef1f4] hover:text-[#181b1e]",
      )}
    >
      <Icon
        size={15}
        strokeWidth={2}
        className={active ? "text-[#fbfcfd]" : "text-[#9aa1a6]"}
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

function GeneralSection({
  airport,
  overview,
  onSaved,
}: {
  airport?: Airport;
  overview?: Overview;
  onSaved: () => void;
}) {
  const [setup, setSetup] = useState<{ users: number; schedules: number } | undefined>();

  useEffect(() => {
    if (!airport) return;
    let live = true;
    Promise.all([api.listUsers(), api.listSchedules(airport.id)])
      .then(([users, schedules]) =>
        live && setSetup({ users: users.length, schedules: schedules.length }),
      )
      .catch(() => live && setSetup({ users: 0, schedules: 0 }));
    return () => {
      live = false;
    };
  }, [airport?.id]);

  if (!airport) {
    return <p className={cn("text-[13px]", MUTED)}>Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <GeneralForm key={airport.id} airport={airport} onSaved={onSaved} />
      <GeneralSnapshot airport={airport} overview={overview} setup={setup} />
    </div>
  );
}

function GeneralSnapshot({
  airport,
  overview,
  setup,
}: {
  airport: Airport;
  overview?: Overview;
  setup?: { users: number; schedules: number };
}) {
  const runways = overview?.runways ?? [];
  const activeRunways = runways.filter((r) => r.runway.activeStatus !== "retired").length;
  const mappedRunways = runways.filter((r) => r.runway.runwayPolygon?.length).length;
  const inspection = overview?.inspection;
  const inspectionStatus = inspection ? INSPECTION_STATUS[inspection.status] : undefined;

  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("px-5 py-3.5", BAR)}>
        <h2 className="text-[14px] font-semibold text-[#181b1e]">Program snapshot</h2>
        <p className={cn("mt-0.5 text-[12px]", MUTED)}>
          Live counts for this deployment — updated when you save or refresh overview data.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-[#dbdfe3] lg:grid-cols-4">
        <SnapshotMetric
          label="Runways"
          value={`${activeRunways}/${runways.length}`}
          detail={mappedRunways ? `${mappedRunways} mapped` : "none mapped yet"}
        />
        <SnapshotMetric
          label="Schedules"
          value={setup ? setup.schedules : "—"}
          detail={setup?.schedules ? "automated passes" : "not configured"}
        />
        <SnapshotMetric
          label="Team"
          value={setup ? setup.users : "—"}
          detail="users with access"
        />
        <SnapshotMetric
          label="Latest pass"
          value={inspectionStatus?.label ?? "None"}
          detail={
            inspection
              ? fmtInTz(inspection.scheduledTime, airport.timezone, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "no inspections yet"
          }
          tone={inspectionStatus?.tone}
        />
      </div>
    </section>
  );
}

function SnapshotMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  tone?: Tone;
}) {
  return (
    <div className={METRIC_CELL}>
      <p className={EYEBROW}>{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums text-[#181b1e]">
        {typeof value === "string" && tone ? <Badge tone={tone}>{value}</Badge> : value}
      </p>
      <p className={cn("mt-0.5 text-[11px]", MUTED)}>{detail}</p>
    </div>
  );
}

function GeneralForm({ airport, onSaved }: { airport: Airport; onSaved: () => void }) {
  const [selected, setSelected] = useState<UsAirportRef | null>(null);
  const [name, setName] = useState(airport.name);
  const [code, setCode] = useState(airport.code);
  const [location, setLocation] = useState(airport.location);
  const [timezone, setTimezone] = useState(airport.timezone);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");

  useEffect(() => {
    void loadUsAirports().then((airports) => {
      setSelected(matchUsAirport(airports, airport.code, airport.name) ?? null);
    });
  }, [airport.code, airport.name]);

  const applyAirport = (ref: UsAirportRef) => {
    setSelected(ref);
    setName(ref.name);
    setCode(ref.code);
    setLocation(ref.location);
    setTimezone(ref.timezone);
  };

  // Treat the center as "changed" only beyond ~1 km so a directory pick whose
  // coordinate differs trivially from the stored center doesn't flag the form
  // dirty (and a save then won't reposition runways — see lib/repo.ts).
  const CENTER_MOVE_DEG = 0.01;
  const dirty =
    name !== airport.name ||
    code !== airport.code ||
    location !== airport.location ||
    timezone !== airport.timezone ||
    (selected != null &&
      (airport.centerLat == null ||
        airport.centerLng == null ||
        Math.abs(airport.centerLat - selected.lat) > CENTER_MOVE_DEG ||
        Math.abs(airport.centerLng - selected.lng) > CENTER_MOVE_DEG));

  const save = async () => {
    setBusy(true);
    setStatus("idle");
    try {
      await api.updateAirport(airport.id, {
        name,
        code,
        location,
        timezone,
        ...(selected ? { centerLat: selected.lat, centerLng: selected.lng } : {}),
      });
      setStatus("ok");
      onSaved();
    } catch {
      setStatus("err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <AirportSearchSelect value={selected} onChange={applyAirport} disabled={busy} />
        <ReadOnlyField label="Code" value={code} />
        <ReadOnlyField label="Location" value={location} />
        <ReadOnlyField label="Timezone" value={timezone} />
      </div>
      <p className={cn("text-[11px]", MUTED)}>
        Search the US airport directory — only United States airfields (states and territories). Code, location, and timezone fill in automatically.
      </p>
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
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label className={EYEBROW}>{label}</label>
      <div
        className={cn(
          "flex h-8 items-center rounded-md border border-[#e4e8eb] bg-[#f3f5f7] px-3 text-[12px] text-[#181b1e]",
          !value && "text-[#9aa1a6]",
        )}
      >
        {value || "—"}
      </div>
    </div>
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

const SCHEDULE_WINDOW_HELP: Record<InspectionWindow, string> = {
  daylight: "Runs during standard daylight hours for optimal imaging.",
  dusk_lit: "Runs at dusk with runway lighting for low-light capture.",
};

const SECTION_INFO: Record<Exclude<SectionId, "general">, SidebarInfo> = {
  users: {
    title: "Members",
    desc: "Create accounts, rotate access, and remove users that no longer need this airfield.",
    body: (
      <dl className="space-y-3">
        <InfoItem term="Credentials" detail="New members sign in with the username and password set here." />
        <InfoItem term="Last admin" detail="The final admin account is protected from removal." />
      </dl>
    ),
  },
  runways: {
    title: "Map status",
    desc: "Open a runway to edit boundaries, zones, and map data.",
    body: (
      <dl className="space-y-3">
        {(Object.keys(MAP_STATUS_LABEL) as RunwayMapStatus[]).map((s) => (
          <div key={s} className="space-y-1">
            <dt>
              <Badge tone={s === "active" ? "green" : s === "needs_review" ? "amber" : "gray"}>
                {MAP_STATUS_LABEL[s]}
              </Badge>
            </dt>
            <dd className="text-[12px] leading-relaxed text-[#3f4448]">
              {s === "draft" && "Polygon defined but not yet approved for inspections."}
              {s === "active" && "Current operational boundary used for zone placement."}
              {s === "retired" && "Historical boundary — no longer used for new passes."}
              {s === "needs_review" && "Boundary flagged for admin review before next pass."}
            </dd>
          </div>
        ))}
        <InfoItem
          term="Zones"
          detail="Open a runway row to add or edit inspection segments along its length."
        />
      </dl>
    ),
  },
  schedule: {
    title: "Illumination windows",
    desc: "When a scheduled pass runs relative to local daylight.",
    body: (
      <dl className="space-y-3">
        {INSPECTION_WINDOWS.map((w) => (
          <InfoItem key={w} term={INSPECTION_WINDOW[w]} detail={SCHEDULE_WINDOW_HELP[w]} />
        ))}
        <InfoItem
          term="Enabled"
          detail="Disabled schedules stay on file but won't trigger automated passes."
        />
      </dl>
    ),
  },
  data: {
    title: "Export formats",
    desc: "Reports from any completed scheduled pass.",
    body: (
      <dl className="space-y-3">
        <InfoItem
          term="Pass history"
          detail="Pick a day from the dropdown to export that run’s report. Passes are created by the automated schedule."
        />
        <InfoItem term="HTML / PDF" detail="Human-readable inspection report with issue summary." />
        <InfoItem term="CSV" detail="Tabular issue list for spreadsheets and work-order systems." />
        <InfoItem term="JSON" detail="Structured payload for integrations and downstream tooling." />
      </dl>
    ),
  },
};

function GeneralInfoPanel({
  overview,
  airport,
}: {
  overview?: Overview;
  airport: Airport;
}) {
  const [setup, setSetup] = useState<{ users: number; schedules: number } | undefined>();

  useEffect(() => {
    let live = true;
    Promise.all([api.listUsers(), api.listSchedules(airport.id)])
      .then(([users, schedules]) =>
        live && setSetup({ users: users.length, schedules: schedules.length }),
      )
      .catch(() => live && setSetup({ users: 0, schedules: 0 }));
    return () => {
      live = false;
    };
  }, [airport.id]);

  const runways = overview?.runways ?? [];
  const mappedRunways = runways.filter((r) => r.runway.runwayPolygon?.length).length;
  const checklist = [
    {
      label: "Airfield identity",
      ok: Boolean(airport.name && airport.code),
      detail: "Name and code set for reports and navigation.",
    },
    {
      label: "Runways defined",
      ok: runways.length > 0,
      detail: runways.length ? `${runways.length} runway${runways.length === 1 ? "" : "s"}` : "Add at least one runway.",
    },
    {
      label: "Boundaries mapped",
      ok: mappedRunways > 0,
      detail: mappedRunways
        ? `${mappedRunways} with operational polygons`
        : "Draw or import runway boundaries.",
    },
    {
      label: "Automated schedule",
      ok: (setup?.schedules ?? 0) > 0,
      detail: setup?.schedules
        ? `${setup.schedules} pass${setup.schedules === 1 ? "" : "es"} configured`
        : "Configure in Schedule.",
    },
    {
      label: "Team access",
      ok: (setup?.users ?? 0) > 1,
      detail: setup ? `${setup.users} user${setup.users === 1 ? "" : "s"} onboard` : "Invite users in Users & access.",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className={EYEBROW}>Setup checklist</p>
        <ul className="mt-2 space-y-2">
          {checklist.map((item) => (
            <SetupCheck key={item.label} {...item} />
          ))}
        </ul>
      </div>
      <div className="border-t border-[#dbdfe3] pt-4">
        <p className={EYEBROW}>Deployment</p>
        <dl className="mt-2 space-y-2">
          <InfoItem term="Airport ID" detail={airport.id} />
          <InfoItem
            term="Created"
            detail={fmtInTz(airport.createdAt, airport.timezone, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          />
        </dl>
      </div>
      <div className="border-t border-[#dbdfe3] pt-4">
        <p className={EYEBROW}>Field reference</p>
        <dl className="mt-2 space-y-2">
          <InfoItem term="Name" detail="Full airport name shown in headers and reports." />
          <InfoItem term="Code" detail="ICAO or local identifier (e.g. AGS)." />
          <InfoItem term="Location" detail="City and state or region for context on exports." />
          <InfoItem term="Timezone" detail="Used to schedule automated passes at local times." />
        </dl>
      </div>
    </div>
  );
}

function SetupCheck({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <li className="flex gap-2">
      <span
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          ok ? "bg-[#44b07f]" : "bg-[#c6ccd1]",
        )}
        aria-hidden
      />
      <div>
        <p className="text-[12px] font-semibold text-[#181b1e]">{label}</p>
        <p className="text-[11px] leading-relaxed text-[#5b6166]">{detail}</p>
      </div>
    </li>
  );
}

function InfoItem({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[12px] font-semibold text-[#181b1e]">{term}</dt>
      <dd className="text-[12px] leading-relaxed text-[#3f4448]">{detail}</dd>
    </div>
  );
}

const userBaseColumns: DataTableColumn<User>[] = [
  {
    colId: "name",
    headerName: "Name",
    field: "name",
    cellClass: "text-[13px] text-[#181b1e]",
    flex: 1,
    minWidth: 160,
  },
  {
    colId: "username",
    headerName: "Username",
    field: "username",
    cellClass: "font-mono text-[12px] text-[#5b6166]",
    flex: 1,
    minWidth: 140,
  },
  {
    colId: "role",
    headerName: "Role",
    field: "role",
    cellClass: ({ data }) =>
      `valanor-status-cell valanor-status-${data ? ROLE_TONE[data.role] : "gray"}`,
    cellRenderer: ({ data }: { data?: User }) =>
      data ? <span title={ROLE_ACCESS[data.role]}>{ROLE[data.role]}</span> : null,
    minWidth: 110,
    maxWidth: 130,
  },
];

const runwayBaseColumns: DataTableColumn<RunwayLite>[] = [
  {
    colId: "name",
    headerName: "Name",
    field: "name",
    cellClass: "text-[13px] font-medium text-[#181b1e]",
    flex: 1,
    minWidth: 140,
  },
  {
    colId: "designation",
    headerName: "Designation",
    field: "designation",
    cellClass: "font-mono text-[12px] text-[#3f4448]",
    flex: 1,
    minWidth: 120,
  },
  {
    colId: "length",
    headerName: "Length",
    valueGetter: ({ data }) => data?.length || "—",
    cellClass: "font-mono text-[12px] text-[#5b6166]",
    minWidth: 100,
  },
  {
    colId: "map",
    headerName: "Map",
    valueGetter: ({ data }) =>
      data?.runwayPolygon?.length ? MAP_STATUS_LABEL[data.mapStatus ?? "draft"] : "Unmapped",
    cellClass: ({ data }) => {
      if (!data) return "valanor-status-cell valanor-status-gray";
      const mapped = Boolean(data.runwayPolygon?.length);
      return `valanor-status-cell valanor-status-${mapStatusTone(data.mapStatus, mapped)}`;
    },
    cellRenderer: ({ data }: { data?: RunwayLite }) => {
      if (!data) return null;
      const mapped = Boolean(data.runwayPolygon?.length);
      const label = mapped ? MAP_STATUS_LABEL[data.mapStatus ?? "draft"] : "Unmapped";
      return <span>{label}</span>;
    },
    minWidth: 110,
    maxWidth: 130,
  },
  {
    colId: "status",
    headerName: "Status",
    valueGetter: ({ data }) => data?.activeStatus ?? "active",
    cellClass: ({ data }) => {
      if (!data) return "valanor-status-cell valanor-status-gray";
      const status = data.activeStatus ?? "active";
      const tone = status === "retired" ? "red" : status === "active" ? "green" : "gray";
      return `valanor-status-cell valanor-status-${tone}`;
    },
    cellRenderer: ({ data }: { data?: RunwayLite }) =>
      data ? <span>{data.activeStatus ?? "active"}</span> : null,
    minWidth: 90,
    maxWidth: 110,
  },
];

function RunwaysSection({
  airportId,
  runways,
  onDone,
}: {
  airportId: string;
  runways: RunwayLite[];
  onDone: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[12px]", MUTED)}>
          {runways.length} runway{runways.length === 1 ? "" : "s"} · click a row to configure zones and map data
        </p>
        <button
          type="button"
          onClick={() => {
            setAdding((v) => !v);
            setErr(null);
          }}
          className={cn("h-8 px-3 text-[12px]", BTN)}
        >
          <Plus size={13} strokeWidth={2} />
          {adding ? "Cancel" : "Add runway"}
        </button>
      </div>

      {adding && (
        <AddRunwayForm
          airportId={airportId}
          onAdded={() => {
            setAdding(false);
            setErr(null);
            onDone();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {err && <p className="text-[12px] font-medium text-[#b91c1c]">{err}</p>}

      <div className="min-h-0 flex-1">
        {runways.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>No runways yet — add one to get started.</p>
        ) : (
          <DataTable
            rows={runways}
            columns={runwayBaseColumns}
            label="Runways"
            fill
            rowHeight={44}
            rowHref={(r) => `/admin/runway/${r.id}`}
            getRowId={(r) => r.id}
          />
        )}
      </div>
    </div>
  );
}

function AddRunwayForm({
  airportId,
  onAdded,
  onCancel,
}: {
  airportId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [length, setLength] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.createRunway({
        airportId,
        name: name.trim(),
        designation: designation.trim(),
        length: length.trim() || undefined,
      });
      setName("");
      setDesignation("");
      setLength("");
      onAdded();
    } catch (e) {
      setErr(apiErrorMessage(e, "Failed to add runway."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("rounded-md p-4", CARD)}>
      <p className="text-[13px] font-semibold text-[#181b1e]">New runway</p>
      <p className={cn("mt-0.5 text-[12px]", MUTED)}>
        Add the basics here — open the runway afterward to set map boundaries and zones.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Input label="Name" value={name} onChange={setName} placeholder="Runway 4" />
        <Input label="Designation" value={designation} onChange={setDesignation} placeholder="14 – 32" />
        <Input label="Length" value={length} onChange={setLength} placeholder="7,000 ft" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!name.trim() || !designation.trim() || busy}
          onClick={() => void submit()}
          className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
        >
          {busy ? "Adding…" : "Add runway"}
        </button>
        <button type="button" onClick={onCancel} className={cn("h-8 px-3 text-[12px]", BTN)}>
          Cancel
        </button>
        {err && <span className="text-[12px] font-medium text-[#b91c1c]">{err}</span>}
      </div>
    </div>
  );
}

function UsersSection({ airportId }: { airportId?: string }) {
  const [users, setUsers] = useState<User[] | undefined>();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<User | null>(null);

  const reload = useCallback(async () => {
    try {
      setUsers(await api.listUsers());
    } catch {
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const adminCount = users?.filter((u) => u.role === "admin").length ?? 0;

  const confirmRemoveUser = useCallback(async () => {
    if (!pendingRemove) return;
    if (pendingRemove.role === "admin" && adminCount <= 1) {
      setErr("Cannot remove the last admin.");
      setPendingRemove(null);
      return;
    }
    setBusyId(pendingRemove.id);
    setErr(null);
    try {
      await api.deleteUser(pendingRemove.id);
      setPendingRemove(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to remove user.");
    } finally {
      setBusyId(null);
    }
  }, [adminCount, pendingRemove, reload]);

  const columns = useMemo<DataTableColumn<User>[]>(
    () => [
      ...userBaseColumns,
      {
        colId: "actions",
        headerName: "",
        sortable: false,
        width: 52,
        maxWidth: 52,
        minWidth: 52,
        cellClass: "valanor-action-cell",
        cellRenderer: ({ data }: { data?: User }) =>
          data ? (
            <div className="flex h-full w-full items-center justify-center">
              <button
                type="button"
                onClick={() => setPendingRemove(data)}
                disabled={busyId === data.id || (data.role === "admin" && adminCount <= 1)}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#c7cdd2] text-[#5b6166] transition-all",
                  "hover:border-[#b91c1c] hover:bg-[#fbeae8] hover:text-[#b91c1c] hover:shadow-[0_0_0_3px_rgba(185,28,28,0.2)]",
                  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#c7cdd2] disabled:hover:bg-transparent disabled:hover:text-[#5b6166] disabled:hover:shadow-none",
                )}
                aria-label={`Remove ${data.name}`}
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          ) : null,
      },
    ],
    [adminCount, busyId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {pendingRemove && (
        <ConfirmDeleteModal
          title="Remove member"
          description="This person will lose access to this airfield. Their account is removed from the system."
          itemLabel={`${pendingRemove.name} · ${ROLE[pendingRemove.role]}`}
          confirmLabel="Remove"
          onCancel={() => setPendingRemove(null)}
          onConfirm={confirmRemoveUser}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[12px]", MUTED)}>
          {users ? `${users.length} member${users.length === 1 ? "" : "s"}` : "Loading members…"}
        </p>
        <button
          type="button"
          onClick={() => {
            setAdding((v) => !v);
            setErr(null);
          }}
          className={cn("h-8 px-3 text-[12px]", BTN)}
        >
          <UserPlus size={13} strokeWidth={2} />
          {adding ? "Cancel" : "Add member"}
        </button>
      </div>

      {adding && (
        <AddUserForm
          airportId={airportId}
          onAdded={async () => {
            setAdding(false);
            setErr(null);
            await reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {err && <p className="text-[12px] font-medium text-[#b91c1c]">{err}</p>}

      <div className="min-h-0 flex-1">
        {!users ? (
          <p className={cn("text-[13px]", MUTED)}>Loading members…</p>
        ) : users.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>No users yet — add someone to get started.</p>
        ) : (
          <DataTable
            rows={users}
            columns={columns}
            label="Users and access"
            fill
            rowHeight={44}
            getRowId={(u) => u.id}
          />
        )}
      </div>
    </div>
  );
}

function AddUserForm({
  airportId,
  onAdded,
  onCancel,
}: {
  airportId?: string;
  onAdded: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<UserRole>("inspector");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const passwordOk = password.length >= 8;
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    name.trim() && username.trim() && passwordOk && passwordsMatch && confirmPassword.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createUser({
        name: name.trim(),
        username: username.trim(),
        password,
        role,
        airportId,
      });
      setName("");
      setUsername("");
      setPassword("");
      setConfirmPassword("");
      setRole("inspector");
      await onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add user.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("rounded-md p-4", CARD)}>
      <p className="text-[13px] font-semibold text-[#181b1e]">New member</p>
      <p className={cn("mt-0.5 text-[12px]", MUTED)}>
        Set a username and password for sign-in. Minimum 8 characters.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input label="Name" value={name} onChange={setName} placeholder="J. Smith" />
        <Input label="Username" value={username} onChange={setUsername} placeholder="jsmith" autoComplete="username" />
        <Select
          label="Role"
          value={role}
          onChange={(v) => setRole(v as UserRole)}
          options={USER_ROLES.map((r) => ({ value: r, label: ROLE[r], hint: ROLE_ACCESS[r] }))}
          showHints={false}
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />
        <Input
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Re-enter password"
          autoComplete="new-password"
        />
      </div>
      {password.length > 0 && !passwordOk && (
        <p className="mt-2 text-[12px] text-[#b91c1c]">Password must be at least 8 characters.</p>
      )}
      {confirmPassword.length > 0 && !passwordsMatch && (
        <p className="mt-2 text-[12px] text-[#b91c1c]">Passwords do not match.</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit || busy}
          onClick={() => void submit()}
          className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
        >
          {busy ? "Adding…" : "Add member"}
        </button>
        <button type="button" onClick={onCancel} className={cn("h-8 px-3 text-[12px]", BTN)}>
          Cancel
        </button>
        {err && <span className="text-[12px] font-medium text-[#b91c1c]">{err}</span>}
      </div>
    </div>
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

  const daily = schedules?.filter((s) => s.inspectionType !== "periodic") ?? [];
  const periodic = schedules?.filter((s) => s.inspectionType === "periodic") ?? [];

  return (
    <>
      <Panel
        title="Daily self-inspection passes"
        desc="The routine movement-area check, run before daily operations begin (§139.327(a))."
        action={
          schedules && (
            <span className={cn("whitespace-nowrap text-[12px]", MUTED)}>
              {daily.length} pass{daily.length === 1 ? "" : "es"}
            </span>
          )
        }
      >
        {!schedules ? (
          <p className={cn("text-[13px]", MUTED)}>Loading schedules…</p>
        ) : daily.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>No daily pass scheduled yet.</p>
        ) : (
          <ul className="divide-y divide-[#dbdfe3]">
            {daily.map((s) => (
              <ScheduleRow key={s.id} schedule={s} onChanged={reload} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Periodic surveillance"
        desc="Recurring weekly, monthly, or quarterly checks — fuel farm, friction testing, lighting (§139.327(c))."
        action={
          schedules && (
            <span className={cn("whitespace-nowrap text-[12px]", MUTED)}>
              {periodic.length} schedule{periodic.length === 1 ? "" : "s"}
            </span>
          )
        }
      >
        {!schedules ? (
          <p className={cn("text-[13px]", MUTED)}>Loading schedules…</p>
        ) : periodic.length === 0 ? (
          <p className={cn("text-[13px]", MUTED)}>
            No periodic surveillance yet — add a recurring check below.
          </p>
        ) : (
          <ul className="divide-y divide-[#dbdfe3]">
            {periodic.map((s) => (
              <ScheduleRow key={s.id} schedule={s} onChanged={reload} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Add schedule" desc="Add a daily pass or a periodic surveillance check with its cadence.">
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
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timeValid = isValidScheduleTime(schedule.time);
  const windowLabel = INSPECTION_WINDOW[schedule.window];
  const isPeriodic = schedule.inspectionType === "periodic";
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteSchedule = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteSchedule(schedule.id);
    } catch (e) {
      const msg = apiErrorMessage(e);
      if (!/not found/i.test(msg)) {
        setErr(msg);
        return;
      }
    } finally {
      setBusy(false);
      setConfirmDelete(false);
      onChanged();
    }
  };

  return (
    <li className="space-y-1 py-2.5">
      {confirmDelete && (
        <ConfirmDeleteModal
          title={isPeriodic ? "Delete surveillance schedule" : "Delete schedule"}
          description={
            isPeriodic
              ? "This periodic surveillance entry will be removed from the inspection program."
              : "This daily pass will be removed from the inspection program."
          }
          itemLabel={
            isPeriodic && schedule.label
              ? `${schedule.label} · ${SCHEDULE_FREQUENCY[schedule.frequency]} · ${schedule.time}`
              : `${schedule.time} · ${windowLabel}`
          }
          onCancel={() => setConfirmDelete(false)}
          onConfirm={confirmDeleteSchedule}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-[#181b1e]">
          {isPeriodic && schedule.label && (
            <span className="font-medium">{schedule.label}</span>
          )}
          {isPeriodic && (
            <Badge tone="purple" compact>
              {SCHEDULE_FREQUENCY[schedule.frequency]}
            </Badge>
          )}
          <span className={cn("font-mono", !timeValid && "text-[#b91c1c]")}>{schedule.time}</span>
          {!timeValid && (
            <Badge tone="amber" compact>
              Invalid time
            </Badge>
          )}
          <span className={cn("text-[12px]", MUTED)}>{windowLabel}</span>
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
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className={cn("h-8 px-3 text-[12px] disabled:opacity-50", BTN)}
          >
            Delete
          </button>
        </span>
      </div>
      {err && <p className="text-[12px] font-medium text-[#b91c1c]">{err}</p>}
    </li>
  );
}

function ScheduleForm({ airportId, onDone }: { airportId: string; onDone: () => void }) {
  const [type, setType] = useState<ScheduleInspectionType>("daily");
  const [time, setTime] = useState("06:00");
  const [win, setWin] = useState<InspectionWindow>("daylight");
  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState<ScheduleFrequency>("monthly");
  const [label, setLabel] = useState("");
  const isPeriodic = type === "periodic";
  const timeValid = isValidScheduleTime(time);
  const labelValid = !isPeriodic || label.trim().length > 0;

  const reset = () => {
    setTime(isPeriodic ? "09:00" : "06:00");
    setEnabled(true);
    setLabel("");
  };

  const applyTemplate = (t: (typeof SURVEILLANCE_TEMPLATES)[number]) => {
    setLabel(t.label);
    setFrequency(t.frequency);
    setTime(t.time);
  };

  return (
    <FormShell
      disabled={!timeValid || !labelValid}
      reset={reset}
      submit={async () => {
        await api.createSchedule({
          airportId,
          time: time.trim(),
          window: win,
          enabled,
          inspectionType: type,
          ...(isPeriodic ? { frequency, label: label.trim() } : {}),
        });
        onDone();
      }}
    >
      <Select
        label="Schedule type"
        value={type}
        onChange={(v) => {
          const next = v as ScheduleInspectionType;
          setType(next);
          setTime(next === "periodic" ? "09:00" : "06:00");
        }}
        options={[
          { value: "daily", label: "Daily self-inspection pass" },
          { value: "periodic", label: "Periodic surveillance" },
        ]}
      />

      {isPeriodic && (
        <div className="space-y-1.5">
          <label className={EYEBROW}>Surveillance templates</label>
          <div className="flex flex-wrap gap-1.5">
            {SURVEILLANCE_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => applyTemplate(t)}
                title={t.detail}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] transition-colors",
                  label === t.label
                    ? "border-[#181b1e] bg-[#181b1e] text-[#eef1f4]"
                    : "border-[#c7cdd2] bg-[#fbfcfd] text-[#5b6166] hover:border-[#888f95] hover:text-[#181b1e]",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isPeriodic && (
        <Input
          label="Surveillance description"
          value={label}
          onChange={setLabel}
          placeholder="e.g. Quarterly fuel farm inspection"
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {isPeriodic && (
          <Select
            label="Frequency"
            value={frequency}
            onChange={(v) => setFrequency(v as ScheduleFrequency)}
            options={PERIODIC_FREQUENCIES.map((f) => ({ value: f, label: SCHEDULE_FREQUENCY[f] }))}
          />
        )}
        <Input label="Time" type="time" value={time} onChange={setTime} placeholder="06:00" />
        <Select
          label="Window"
          value={win}
          onChange={(v) => setWin(v as InspectionWindow)}
          options={INSPECTION_WINDOWS.map((w) => ({ value: w, label: INSPECTION_WINDOW[w] }))}
        />
      </div>
      {!timeValid && (
        <p className="text-[12px] text-[#b91c1c]">Enter a valid local time in 24-hour HH:MM format.</p>
      )}
      {!labelValid && (
        <p className="text-[12px] text-[#b91c1c]">A periodic surveillance schedule needs a description.</p>
      )}
      <label className="flex items-center gap-2 text-[13px] text-[#3f4448]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3.5 w-3.5 accent-[#181b1e]"
        />
        {isPeriodic
          ? "Enabled — part of the active surveillance program."
          : "Enabled — run this pass automatically at the scheduled time."}
      </label>
    </FormShell>
  );
}

// ── Data & export ─────────────────────────────────────────────────────────────

const EXPORT_FORMATS: Array<{
  format: ExportFormat;
  label: string;
  desc: string;
  icon: LucideIcon;
}> = [
  { format: "pdf", label: "PDF report", desc: "Print-ready inspection summary", icon: Download },
  { format: "html", label: "HTML report", desc: "View in browser with checklist and findings", icon: FileText },
  { format: "csv", label: "CSV export", desc: "Issues spreadsheet for analysis", icon: FileSpreadsheet },
  { format: "json", label: "JSON export", desc: "Machine-readable pass data", icon: FileJson },
];

function inspectionPassLabel(inspection: Inspection, timezone: string): string {
  const when = fmtInTz(inspection.scheduledTime, timezone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${when} · ${INSPECTION_TYPE[inspection.type].label}`;
}

function DataSection({
  inspections,
  airport,
  defaultInspectionId,
}: {
  inspections: Inspection[];
  airport?: Airport;
  defaultInspectionId?: string;
}) {
  const tz = airport?.timezone ?? "UTC";
  const sorted = useMemo(
    () => [...inspections].sort((a, b) => b.scheduledTime.localeCompare(a.scheduledTime)),
    [inspections],
  );
  const [selectedId, setSelectedId] = useState("");
  const [counts, setCounts] = useState<{ images: number; issues: number } | null>(null);
  const [preview, setPreview] = useState<ExportFormat | null>(null);
  const previewConfig = preview ? EXPORT_FORMATS.find((t) => t.format === preview) : null;

  useEffect(() => {
    const fallback = defaultInspectionId ?? sorted[0]?.id ?? "";
    setSelectedId((prev) => (prev && sorted.some((i) => i.id === prev) ? prev : fallback));
  }, [defaultInspectionId, sorted]);

  const selected = sorted.find((i) => i.id === selectedId);
  const inspectionStatus = selected ? INSPECTION_STATUS[selected.status] : undefined;
  const exportReady = Boolean(
    selected?.status === "completed" && selected.signedAt && selected.attestation && selected.completedAt,
  );

  useEffect(() => {
    if (!selectedId) {
      setCounts(null);
      return;
    }
    let live = true;
    api
      .getInspection(selectedId)
      .then((detail) => {
        if (!live) return;
        setCounts(
          detail.jobs.reduce(
            (acc, job) => ({
              images: acc.images + job.imageCount,
              issues: acc.issues + job.issueCount,
            }),
            { images: 0, issues: 0 },
          ),
        );
      })
      .catch(() => live && setCounts(null));
    return () => {
      live = false;
    };
  }, [selectedId]);

  const passWhen = selected
    ? fmtInTz(selected.scheduledTime, tz, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <Panel
      title="Export data"
      desc="Download reports from a scheduled inspection pass."
      action={
        selected && inspectionStatus ? (
          <Badge tone={inspectionStatus.tone}>{inspectionStatus.label}</Badge>
        ) : undefined
      }
    >
      {sorted.length > 0 ? (
        <div className="space-y-5">
          <Select
            label="Inspection pass"
            value={selectedId}
            onChange={setSelectedId}
            options={sorted.map((i) => ({
              value: i.id,
              label: inspectionPassLabel(i, tz),
            }))}
          />

          {selected && (
            <>
              <div className="grid gap-px overflow-hidden rounded-md border border-[#dbdfe3] bg-[#dbdfe3] sm:grid-cols-3">
                <SnapshotMetric label="Pass" value={passWhen ?? "—"} detail={selected.id} />
                <SnapshotMetric
                  label="Issues"
                  value={counts?.issues ?? "—"}
                  detail={counts ? "detected on this pass" : "loading…"}
                />
                <SnapshotMetric
                  label="Images"
                  value={counts?.images ?? "—"}
                  detail={counts ? "captured across runways" : "loading…"}
                />
              </div>

              <div>
                <p className={EYEBROW}>Reports</p>
                <p className={cn("mt-1 text-[12px]", MUTED)}>
                  {exportReady
                    ? "Human-readable and machine-readable exports for the selected final record."
                    : "Exports unlock after the checklist is complete and the inspector attestation is signed."}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {EXPORT_FORMATS.map((tile) => (
                    <ExportTile
                      key={tile.format}
                      label={tile.label}
                      desc={tile.desc}
                      icon={tile.icon}
                      disabled={!exportReady}
                      onClick={() => setPreview(tile.format)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={cn("rounded-md border border-dashed border-[#c7cdd2] px-4 py-8 text-center", MUTED)}>
          <p className="text-[13px] font-medium text-[#181b1e]">No inspection passes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed">
            Passes are created by the automated schedule. Configure one under Schedule, then exports will appear here.
          </p>
        </div>
      )}

      {preview && previewConfig && selected && exportReady && (
        <ExportPreviewModal
          url={api.reportUrl(selected.id, preview)}
          format={preview}
          label={previewConfig.label}
          icon={previewConfig.icon}
          filename={`inspection-${selected.id}.${preview}`}
          passLabel={inspectionPassLabel(selected, tz)}
          onClose={() => setPreview(null)}
        />
      )}
    </Panel>
  );
}

function ExportTile({
  label,
  desc,
  icon: Icon,
  disabled = false,
  onClick,
}: {
  label: string;
  desc: string;
  icon: LucideIcon;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Export blocked until this inspection is a signed final compliance record." : undefined}
      className="group flex w-full flex-col gap-1 rounded-md border border-[#dbdfe3] bg-[#fbfcfd] p-3 text-left transition-colors hover:border-[#b8c0c6] hover:bg-[#f3f5f7] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#dbdfe3] disabled:hover:bg-[#fbfcfd]"
    >
      <span className="flex items-center gap-2">
        <Icon
          size={14}
          strokeWidth={2}
          className="shrink-0 text-[#6b7176] transition-colors group-hover:text-[#181b1e]"
        />
        <span className="text-[13px] font-semibold text-[#181b1e]">{label}</span>
        <ChevronRight
          size={14}
          strokeWidth={2}
          className="ml-auto shrink-0 text-[#b0b6bb] transition-colors group-hover:text-[#6b7176]"
        />
      </span>
      <span className={cn("text-[11px] leading-relaxed", MUTED)}>{desc}</span>
    </button>
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
  const [errMsg, setErrMsg] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true);
            setOk(false);
            setErrMsg(null);
            try {
              await submit();
              setOk(true);
              reset();
            } catch (e) {
              setErrMsg(apiErrorMessage(e, "Failed to save."));
            } finally {
              setBusy(false);
            }
          }}
          className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
        >
          {busy ? "Saving…" : "Create"}
        </button>
        {ok && <span className="font-mono text-[11px] text-[#5b6166]">Saved.</span>}
        {errMsg && <span className="text-[11px] font-medium text-[#b91c1c]">{errMsg}</span>}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "time";
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1">
      <label className={EYEBROW}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
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
  showHints = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  showHints?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className={EYEBROW}>{label}</label>
      <SelectMenu
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={label}
        showHints={showHints}
      />
    </div>
  );
}
