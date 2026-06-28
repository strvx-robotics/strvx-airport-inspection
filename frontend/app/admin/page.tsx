"use client";

import { useState } from "react";
import { Cog, Play, FileText, FileJson, Download } from "lucide-react";
import { useOverview, useStore } from "@/lib/store";
import * as api from "@/lib/api";
import { INSPECTION_WINDOW } from "@/lib/ui";
import { INSPECTION_WINDOWS } from "@/lib/types";
import type { InspectionWindow } from "@/lib/types";
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

export default function AdminPage() {
  const { role } = useStore();
  const { overview, refresh } = useOverview();

  if (role !== "admin") {
    return (
      <div className={cn("min-h-full px-6 py-6", PAGE)}>
        <div className="mx-auto max-w-6xl space-y-4">
          <div>
            <p className={EYEBROW}>Valanor · Configuration</p>
            <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
              <Cog size={17} strokeWidth={2} /> Admin
            </h1>
          </div>
          <div className={cn("rounded-md px-4 py-3 text-[13px]", CARD, MUTED)}>
            Switch to the Admin role to manage airports, runways, and schedules.
          </div>
        </div>
      </div>
    );
  }

  const airportId = overview?.airport.id ?? "ags";
  const inspectionId = overview?.inspection?.id;
  const runways = overview?.runways.map((r) => r.runway) ?? [];

  return (
    <div className={cn("min-h-full px-6 py-6", PAGE)}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <p className={EYEBROW}>Valanor · Configuration</p>
          <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
            <Cog size={17} strokeWidth={2} /> Admin
          </h1>
          <p className={cn("mt-1 text-[13px]", MUTED)}>
            Manage the inspection program, run a pass, and export learning data.
          </p>
        </div>

        <RunAndExport inspectionId={inspectionId} onRan={() => void refresh()} />

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Create airport">
            <AirportForm onDone={() => void refresh()} />
          </Card>
          <Card title="Create runway">
            <RunwayForm airportId={airportId} onDone={() => void refresh()} />
          </Card>
          <Card title="Create zone">
            <ZoneForm runways={runways} onDone={() => void refresh()} />
          </Card>
          <Card title="Create schedule">
            <ScheduleForm airportId={airportId} onDone={() => void refresh()} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function RunAndExport({
  inspectionId,
  onRan,
}: {
  inspectionId?: string;
  onRan: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const runNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const insp = await api.runInspectionNow();
      setMsg(`Materialized inspection ${insp.id}.`);
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
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center px-4 py-3", BAR)}>
        <h2 className="text-[13px] font-semibold text-[#e7eaec]">Run &amp; export</h2>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runNow}
            disabled={busy}
            className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
          >
            <Play size={13} strokeWidth={2} />
            {busy ? "Running…" : "Run 6 AM inspection now"}
          </button>
          <button
            onClick={exportFeedback}
            className={cn("h-8 px-3 text-[12px]", BTN)}
          >
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
                <FileText size={13} strokeWidth={2} /> Report (HTML)
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
    </section>
  );
}

function AirportForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  return (
    <FormShell
      disabled={!name || !code}
      reset={() => {
        setName("");
        setCode("");
        setLocation("");
      }}
      submit={async () => {
        await api.createAirport({
          name,
          code,
          location: location || undefined,
        });
        onDone();
      }}
    >
      <Input label="Name" value={name} onChange={setName} placeholder="Augusta Regional" />
      <Input label="Code" value={code} onChange={setCode} placeholder="AGS" />
      <Input label="Location" value={location} onChange={setLocation} placeholder="Augusta, GA" />
    </FormShell>
  );
}

function RunwayForm({
  airportId,
  onDone,
}: {
  airportId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [length, setLength] = useState("");
  return (
    <FormShell
      disabled={!name || !designation}
      reset={() => {
        setName("");
        setDesignation("");
        setLength("");
      }}
      submit={async () => {
        await api.createRunway({
          airportId,
          name,
          designation,
          length: length || undefined,
        });
        onDone();
      }}
    >
      <Input label="Name" value={name} onChange={setName} placeholder="Runway 4" />
      <Input label="Designation" value={designation} onChange={setDesignation} placeholder="14 – 32" />
      <Input label="Length" value={length} onChange={setLength} placeholder="7,000 ft" />
    </FormShell>
  );
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

function ScheduleForm({
  airportId,
  onDone,
}: {
  airportId: string;
  onDone: () => void;
}) {
  const [time, setTime] = useState("06:00");
  const [win, setWin] = useState<InspectionWindow>("daylight");
  return (
    <FormShell
      disabled={!time}
      reset={() => setTime("06:00")}
      submit={async () => {
        await api.createSchedule({ airportId, time, window: win, enabled: true });
        onDone();
      }}
    >
      <Input label="Time" value={time} onChange={setTime} placeholder="06:00" />
      <Select
        label="Window"
        value={win}
        onChange={(v) => setWin(v as InspectionWindow)}
        options={INSPECTION_WINDOWS.map((w) => ({
          value: w,
          label: INSPECTION_WINDOW[w],
        }))}
      />
    </FormShell>
  );
}

// ── Small form primitives (Valanor workspace look) ────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cn("overflow-hidden rounded-md", CARD)}>
      <div className={cn("flex items-center px-4 py-3", BAR)}>
        <h2 className="text-[13px] font-semibold text-[#e7eaec]">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

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
    <div className="space-y-3">
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
        {ok && <span className="font-mono text-[11px] text-[#56c98a]">Saved.</span>}
        {err && <span className="font-mono text-[11px] text-[#e2685c]">Failed.</span>}
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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 w-full px-2", INPUT)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
