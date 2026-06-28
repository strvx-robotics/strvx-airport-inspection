// Airfield work-order derivation (docs/example-ticket.md).
//
// A maintenance Ticket stores the essentials (category, severity, location,
// description). A real airfield work order shows more: defect class, hazard,
// operational status, required action, priority, due window, closure criteria,
// follow-up. Per FAA/airport pavement + FOD guidance those are a STANDARD of the
// defect class and severity — so we derive them from the category/severity the
// ticket already carries instead of storing redundant columns. The per-incident
// facts (location, immediate action taken) come from the linked IssueCandidate.
//
// Pure, no I/O — safe to import from client components (the ticket page does).

import type {
  IssueCandidate,
  IssueCategory,
  Runway,
  Severity,
  Ticket,
} from "./types";

// ── Defect-class taxonomy (keyed by issue category) ───────────────────────────

const ASSET: Record<IssueCategory, string> = {
  fod: "Runway surface · movement area",
  pavement: "Runway pavement",
  marking: "Runway marking",
  lighting: "Airfield lighting / signage",
};

const DEFECT: Record<IssueCategory, string> = {
  fod: "Foreign object debris (FOD)",
  pavement: "Pavement distress / surface damage",
  marking: "Faded or damaged runway marking",
  lighting: "Lighting / signage fault",
};

const HAZARD: Record<IssueCategory, string> = {
  fod: "FOD — debris ingestion · tire and engine damage",
  pavement: "FOD generation · tire and gear damage",
  marking: "Reduced pilot guidance · runway-incursion risk",
  lighting: "Reduced conspicuity for night / low-visibility ops",
};

const WORK_REQUIRED: Record<IssueCategory, string> = {
  fod: "Dispatch a FOD sweep, remove and bag the object, then re-inspect the surface.",
  pavement:
    "Sweep/vacuum loose material, saw-cut and patch the distress, seal adjacent joints as required.",
  marking:
    "Schedule remarking of the affected segment to restore visibility to standard.",
  lighting:
    "Inspect, then repair or replace the affected fixture before night operations.",
};

const CLOSURE: Record<IssueCategory, string> = {
  fod: "No loose debris on the surface; area swept; supervisor re-inspection passed.",
  pavement:
    "No loose material; patch flush and cured to airfield standard; re-inspected and signed off.",
  marking: "Marking restored to standard visibility; re-inspected and signed off.",
  lighting:
    "Fixture operational and correctly aligned; re-inspected and signed off.",
};

const RELATED: Record<IssueCategory, string> = {
  fod: "File a FOD report; check the adjacent surface for the debris source.",
  pavement: "Evaluate adjacent slabs and joints for similar distress.",
  marking: "Review adjacent markings for comparable wear.",
  lighting: "Check adjacent fixtures on the same lighting circuit.",
};

// ── Severity → operational response ───────────────────────────────────────────

const OP_STATUS: Record<Severity, string> = {
  low: "Runway open · routine repair",
  medium: "Runway open · monitor and schedule repair",
  high: "Runway open with caution · immediate action required",
  critical: "Close affected runway / section until repaired",
};

const PRIORITY: Record<Severity, string> = {
  low: "P3 · routine",
  medium: "P2 · within 72 hours",
  high: "P1 · same shift",
  critical: "P1 · immediate",
};

const DUE: Record<Severity, string> = {
  low: "Next scheduled maintenance window",
  medium: "Within 72 hours",
  high: "Before the next departure bank · within 2 hours",
  critical: "Before next operation · immediately",
};

// ── Per-incident facts (from the linked candidate) ────────────────────────────

function defectOf(category: IssueCategory, issue?: IssueCandidate): string {
  const base = DEFECT[category];
  return issue?.sizeM != null ? `${base} (~${issue.sizeM} m)` : base;
}

function locationOf(
  ticket: Ticket,
  issue?: IssueCandidate,
  runway?: Runway,
): string {
  const parts: string[] = [];
  if (runway?.designation) parts.push(`RWY ${runway.designation}`);
  if (ticket.zone) parts.push(ticket.zone);
  if (issue?.stationM != null)
    parts.push(`~${Math.round(issue.stationM)} m from threshold`);
  if (issue?.lateralOffsetM != null) {
    const off = issue.lateralOffsetM;
    parts.push(
      off === 0
        ? "on centerline"
        : `${Math.abs(off).toFixed(1)} m ${off < 0 ? "left" : "right"} of centerline`,
    );
  }
  if (issue?.gps)
    parts.push(`${issue.gps.lat.toFixed(4)}, ${issue.gps.lng.toFixed(4)}`);
  return parts.join(" · ") || "—";
}

/** ISO → stable, locale-free stamp, e.g. "22 Jun 2026 · 06:30 UTC". */
function stamp(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toUTCString(); // "Mon, 22 Jun 2026 06:30:00 GMT"
  const m = /^\w+, (\d+ \w+ \d+) (\d+:\d+):\d+ GMT$/.exec(s);
  return m ? `${m[1]} · ${m[2]} UTC` : s;
}

// ── Public shape ──────────────────────────────────────────────────────────────

export interface WorkOrderField {
  label: string;
  value: string;
}

/**
 * Build the full airfield work order shown on the ticket page. Standard fields
 * are derived from category/severity; location/discovery/immediate-action come
 * from the ticket + linked candidate. Returns an ordered label/value list.
 */
export function buildWorkOrder(
  ticket: Ticket,
  issue?: IssueCandidate,
  runway?: Runway,
): WorkOrderField[] {
  const cat = ticket.category;
  const sev = ticket.severity;

  const fields: WorkOrderField[] = [
    { label: "Defect type", value: defectOf(cat, issue) },
    { label: "Asset", value: ASSET[cat] },
    { label: "Location", value: locationOf(ticket, issue, runway) },
    { label: "Hazard", value: HAZARD[cat] },
    { label: "Operational status", value: OP_STATUS[sev] },
    { label: "Priority", value: PRIORITY[sev] },
    { label: "Due", value: DUE[sev] },
    { label: "Work required", value: WORK_REQUIRED[cat] },
    { label: "Closure criteria", value: CLOSURE[cat] },
    { label: "Related items", value: RELATED[cat] },
  ];

  if (issue?.confidence != null)
    fields.push({
      label: "Detection confidence",
      value: `${Math.round(issue.confidence * 100)}%`,
    });
  if (ticket.createdBy)
    fields.push({ label: "Reported by", value: ticket.createdBy });
  fields.push({ label: "Logged", value: stamp(ticket.createdAt) });
  if (ticket.assignedTo)
    fields.push({ label: "Assigned to", value: ticket.assignedTo });

  // Only surface a real, inspector-recorded action — never fabricate one.
  const taken = issue?.inspectorNotes?.trim();
  if (taken) fields.push({ label: "Immediate action taken", value: taken });

  return fields;
}

// ── Self-check (ponytail: run with `npx tsx lib/workOrder.ts`) ────────────────

function selfCheck(): void {
  const cats: IssueCategory[] = ["fod", "pavement", "marking", "lighting"];
  const sevs: Severity[] = ["low", "medium", "high", "critical"];
  const base: Ticket = {
    id: "WO-1042", issueId: "i1", runwayId: "r2", zone: "Zone A · threshold",
    category: "fod", severity: "high", description: "x", status: "sent",
    createdBy: "Inspector", assignedTo: "Field Maintenance", maintenanceNotes: "",
    createdAt: "2026-06-22T06:30:00.000Z",
  };

  // Every category/severity combo derives a complete, non-empty work order.
  for (const category of cats)
    for (const severity of sevs) {
      const wo = buildWorkOrder({ ...base, category, severity });
      const get = (l: string) => wo.find((f) => f.label === l)?.value ?? "";
      console.assert(get("Defect type") !== "", `defect ${category}`);
      console.assert(get("Hazard") !== "", `hazard ${category}`);
      console.assert(get("Priority") !== "", `priority ${severity}`);
      console.assert(get("Operational status") !== "", `op ${severity}`);
      console.assert(get("Closure criteria") !== "", `closure ${category}`);
    }

  // Location stitches the real per-incident facts together.
  const loc = buildWorkOrder(
    base,
    {
      stationM: 1850, lateralOffsetM: -3, gps: { lat: 33.37, lng: -81.96 },
    } as IssueCandidate,
    { designation: "08 – 26" } as Runway,
  ).find((f) => f.label === "Location")!.value;
  console.assert(loc.includes("RWY 08 – 26"), "loc runway");
  console.assert(loc.includes("1850 m from threshold"), "loc station");
  console.assert(loc.includes("3.0 m left of centerline"), "loc lateral");

  // Immediate action appears only when actually recorded.
  console.assert(
    !buildWorkOrder(base).some((f) => f.label === "Immediate action taken"),
    "no fabricated action",
  );
  console.assert(
    buildWorkOrder(base, { inspectorNotes: "Coned and marked." } as IssueCandidate)
      .some((f) => f.label === "Immediate action taken"),
    "real action shown",
  );

  console.log("workOrder self-check passed");
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.replace(/\\/g, "/").endsWith("lib/workOrder.ts")
) {
  selfCheck();
}
