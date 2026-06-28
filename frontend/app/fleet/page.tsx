import { PlaneTakeoff } from "lucide-react";
import Badge, { type Tone } from "@/components/Badge";
import { cn } from "@/lib/cn";
import { CARD, BAR, EYEBROW, H2, MUTED } from "@/lib/vstyle";

const CELL = "px-4 py-3 text-left align-middle";
const RULE = "border-l border-[#dbdfe3]";

type FleetStatus = "in_flight" | "idle" | "charging" | "maintenance" | "offline";

interface Aircraft {
  id: string;
  model: string;
  status: FleetStatus;
  battery: number | null; // null when offline / unknown
  lastSeen: string;
  assignment: string;
}

const STATUS: Record<FleetStatus, { label: string; tone: Tone }> = {
  in_flight: { label: "In flight", tone: "blue" },
  idle: { label: "Idle · ready", tone: "green" },
  charging: { label: "Charging", tone: "blue" },
  maintenance: { label: "Maintenance", tone: "purple" },
  offline: { label: "Offline", tone: "black" },
};

// ponytail: static demo roster — there's no drones table or telemetry source yet.
// Replace with a real `drones` table + live telemetry when the fleet is wired up.
const FLEET: Aircraft[] = [
  { id: "VLR-01", model: "DJI Mavic 3 Enterprise", status: "in_flight", battery: 78, lastSeen: "now", assignment: "Runway 1" },
  { id: "VLR-02", model: "DJI Mavic 3 Enterprise", status: "idle", battery: 100, lastSeen: "12m ago", assignment: "Standby" },
  { id: "VLR-03", model: "DJI Matrice 350 RTK", status: "charging", battery: 46, lastSeen: "3m ago", assignment: "Hangar dock 2" },
  { id: "VLR-04", model: "DJI Matrice 350 RTK", status: "maintenance", battery: 0, lastSeen: "2d ago", assignment: "Service bay" },
  { id: "VLR-05", model: "DJI Mavic 3 Enterprise", status: "offline", battery: null, lastSeen: "—", assignment: "—" },
];

/** Fleet roster — the aircraft available for inspection passes + their state. */
export default function FleetPage() {
  const online = FLEET.filter((a) => a.status !== "offline").length;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-6">
      <header>
        <p className={EYEBROW}>Valanor · Fleet</p>
        <h1 className={cn("mt-2 flex items-center gap-2", H2)}>
          <PlaneTakeoff size={17} strokeWidth={2} className="text-[#5b6166]" /> Fleet
        </h1>
      </header>

      <section className={cn("mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
          <h3 className="text-[13px] font-semibold text-[#181b1e]">Aircraft</h3>
          <p className={cn("text-[12px]", MUTED)}>
            {FLEET.length} units · {online} online
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col />
              <col className="w-full" />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-[#dbdfe3]">
                <th className={cn(CELL, "py-2", EYEBROW)}>Aircraft</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Model</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Status</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Battery</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Last seen</th>
                <th className={cn(CELL, "py-2", EYEBROW, RULE)}>Assignment</th>
              </tr>
            </thead>
            <tbody>
              {FLEET.map((a) => (
                <tr key={a.id} className="border-b border-[#dbdfe3] last:border-b-0">
                  <td className={cn(CELL, "whitespace-nowrap font-mono text-[12px] font-semibold text-[#181b1e]")}>
                    {a.id}
                  </td>
                  <td className={cn(CELL, RULE, "text-[12px] text-[#3f4448]")}>{a.model}</td>
                  <td className={cn(CELL, RULE, "whitespace-nowrap")}>
                    <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                  </td>
                  <td className={cn(CELL, RULE, "whitespace-nowrap")}>
                    <Battery pct={a.battery} />
                  </td>
                  <td className={cn(CELL, RULE, "whitespace-nowrap font-mono text-[12px]", MUTED)}>
                    {a.lastSeen}
                  </td>
                  <td className={cn(CELL, RULE, "whitespace-nowrap text-[12px] text-[#3f4448]")}>
                    {a.assignment}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Monochrome battery gauge — track + ink fill, percent label. "—" when offline. */
function Battery({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className={cn("font-mono text-[12px]", MUTED)}>—</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e3e5e8]">
        <div className="h-full rounded-full bg-[#181b1e]" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-[#5b6166]">{pct}%</span>
    </div>
  );
}
