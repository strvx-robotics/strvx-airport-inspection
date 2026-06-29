"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ScrollText,
  ArrowUpRight,
  Download,
  ClipboardCheck,
  PenLine,
  Lock,
} from "lucide-react";
import Badge from "@/components/Badge";
import * as api from "@/lib/api";
import { useStore } from "@/lib/store";
import { fmtInTz } from "@/lib/format";
import {
  CATEGORY,
  CHECKLIST_RESULT,
  DECISION,
  INSPECTION_STATUS,
  INSPECTION_TYPE,
  INSPECTION_WINDOW,
  pct,
} from "@/lib/ui";
import { CHECKLIST_RESULTS, type ChecklistResult } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  CARD,
  BAR,
  BTN,
  BTN_PRIMARY,
  INPUT,
  METRIC_CELL,
  EYEBROW,
  H2,
  MUTED,
  LINK,
  DOT,
} from "@/lib/vstyle";

const RESULT_ACTIVE: Record<ChecklistResult, string> = {
  pass: "border-transparent bg-[#15803d] text-white",
  fail: "border-transparent bg-[#b91c1c] text-white",
  na: "border-transparent bg-[#6b7176] text-white",
};

/** Inspection detail — the daily pass report rendered inside the console: the
 *  Part 139-style self-inspection checklist + sign-off, then one card per runway
 *  with the AI issue candidates linking through to their review pages. */
export default function InspectionPage() {
  const { id } = useParams<{ id: string }>();
  const { role } = useStore();
  const [report, setReport] = useState<api.InspectionReport | undefined>();
  const [detail, setDetail] = useState<api.InspectionWithJobs | undefined>();
  const [loading, setLoading] = useState(true);
  const [signName, setSignName] = useState("");

  const canInspect = role === "inspector" || role === "admin";

  const refresh = useCallback(
    () =>
      Promise.all([api.getReport(id), api.getInspection(id)])
        .then(([r, d]) => {
          setReport(r);
          setDetail(d);
        })
        .catch(() => undefined),
    [id],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    refresh().finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [refresh]);

  if (!report) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-6 py-6">
        <p className={cn("text-[13px]", MUTED)}>
          {loading ? "Loading inspection…" : "Inspection not found."}
        </p>
        {!loading && (
          <Link href="/logs" className={cn("inline-flex items-center gap-1", LINK)}>
            <ChevronLeft size={14} strokeWidth={2} /> Inspection log
          </Link>
        )}
      </div>
    );
  }

  const { airport, totals, runways } = report;
  const insp = detail?.inspection ?? report.inspection;
  const checklist = detail?.checklist ?? [];
  const evidence = detail?.images ?? [];
  const tz = airport.timezone;
  const status = INSPECTION_STATUS[insp.status];
  const typeBadge = INSPECTION_TYPE[insp.type] ?? INSPECTION_TYPE.daily;
  const completed = checklist.filter((c) => c.result).length;
  const allComplete = checklist.length > 0 && completed === checklist.length;

  const setResult = (itemKey: string, result: ChecklistResult) => {
    const item = checklist.find((c) => c.itemKey === itemKey);
    void api
      .saveChecklistItem(id, itemKey, result, item?.notes, item?.imageId ?? undefined)
      .then((next) => setDetail((d) => (d ? { ...d, checklist: next } : d)))
      .catch(() => undefined);
  };
  const setNotes = (itemKey: string, notes: string) => {
    const item = checklist.find((c) => c.itemKey === itemKey);
    if (!item?.result || notes === item.notes) return; // a result is required to persist a note
    void api
      .saveChecklistItem(id, itemKey, item.result, notes, item.imageId ?? undefined)
      .then((next) => setDetail((d) => (d ? { ...d, checklist: next } : d)))
      .catch(() => undefined);
  };
  const setEvidence = (itemKey: string, imageId: string | null) => {
    const item = checklist.find((c) => c.itemKey === itemKey);
    if (!item?.result) return;
    void api
      .saveChecklistItem(id, itemKey, item.result, item.notes, imageId ?? undefined)
      .then((next) => setDetail((d) => (d ? { ...d, checklist: next } : d)))
      .catch(() => undefined);
  };
  const sign = () => {
    if (!signName.trim()) return;
    void api.signInspection(id, signName.trim()).then(() => refresh()).catch(() => undefined);
  };

  const metrics = [
    { label: "Issues", value: totals.issues },
    { label: "Tickets", value: totals.tickets },
    { label: "Open", value: totals.ticketsOpen },
    { label: "Completed", value: totals.ticketsCompleted },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      {/* toolbar — navigation + the report action, both as buttons */}
      <div className="flex items-center justify-between gap-3">
        <Link href="/logs" className={cn("h-8 pl-2 pr-3 text-[12px]", BTN)}>
          <ChevronLeft size={15} strokeWidth={2} /> Inspection log
        </Link>
        <div className="flex items-center gap-2">
          <a href={api.reportUrl(id, "csv")} className={cn("h-8 px-3 text-[12px]", BTN)}>
            Export CSV
          </a>
          <a href={api.reportUrl(id, "pdf")} className={cn("h-8 px-3 text-[12px]", BTN)}>
            <Download size={14} strokeWidth={2} /> Download PDF
          </a>
          <a
            href={api.reportUrl(id, "html")}
            target="_blank"
            rel="noreferrer"
            className={cn("h-8 px-3 text-[12px]", BTN)}
          >
            Open HTML report <ArrowUpRight size={14} strokeWidth={2} />
          </a>
        </div>
      </div>

      {/* header box — matches the issue / ticket / dashboard command strip */}
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 py-3", BAR)}>
          <div className="min-w-0">
            <p className={EYEBROW}>
              {airport.name} · {airport.code}
            </p>
            <h2 className={cn("mt-1 flex items-center gap-2", H2)}>
              <ScrollText size={17} strokeWidth={2} className="text-[#5b6166]" />
              {fmtInTz(insp.scheduledTime, tz, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </h2>
            <p className={cn("mt-1 text-[13px]", MUTED)}>
              {INSPECTION_WINDOW[insp.window]} ·{" "}
              {fmtInTz(insp.scheduledTime, tz, { hour: "2-digit", minute: "2-digit" })}
              {insp.reason ? ` · ${insp.reason}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={typeBadge.tone}>{typeBadge.label}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        </div>
      </section>

      {/* totals strip */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#dbdfe3] bg-[#dbdfe3] sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className={METRIC_CELL}>
            <dt className={EYEBROW}>{m.label}</dt>
            <dd className="mt-1 font-mono text-[20px] tabular-nums text-[#181b1e]">
              {m.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* daily self-inspection checklist (PRD §6) */}
      {checklist.length > 0 && (
        <section className={cn("overflow-hidden rounded-md", CARD)}>
          <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#181b1e]">
              <ClipboardCheck size={15} strokeWidth={2} className="text-[#5b6166]" />
              Daily self-inspection checklist
            </h3>
            <p className={cn("font-mono text-[12px] tabular-nums", MUTED)}>
              {completed} / {checklist.length} complete
            </p>
          </div>
          <ul className="divide-y divide-[#dbdfe3]">
            {checklist.map((item) => (
              <li key={item.itemKey} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] text-[#181b1e]">
                    <span className={cn("text-[11px]", MUTED)}>{CATEGORY[item.category]}</span>
                    {item.label}
                  </span>
                  <div className="flex gap-1">
                    {CHECKLIST_RESULTS.map((res) => (
                      <button
                        key={res}
                        onClick={() => setResult(item.itemKey, res)}
                        disabled={!canInspect}
                        className={cn(
                          "h-7 rounded border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          item.result === res
                            ? RESULT_ACTIVE[res]
                            : "border-[#dbdfe3] bg-white text-[#3f4448] hover:bg-[#eef1f4]",
                        )}
                      >
                        {CHECKLIST_RESULT[res].label}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  defaultValue={item.notes}
                  disabled={!canInspect || !item.result}
                  onBlur={(e) => setNotes(item.itemKey, e.target.value)}
                  placeholder={item.result ? "Add a note…" : "Set a result to add a note"}
                  className={cn(
                    "mt-2 h-8 w-full px-2.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50",
                    INPUT,
                  )}
                />
                {evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className={cn("text-[11px]", MUTED)} htmlFor={`evidence-${item.itemKey}`}>
                      Photo / video evidence
                    </label>
                    <select
                      id={`evidence-${item.itemKey}`}
                      value={item.imageId ?? ""}
                      disabled={!canInspect || !item.result}
                      onChange={(e) => setEvidence(item.itemKey, e.target.value || null)}
                      className={cn(
                        "h-8 min-w-[12rem] flex-1 px-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-50",
                        INPUT,
                      )}
                    >
                      <option value="">None linked</option>
                      {evidence.map((img) => (
                        <option key={img.id} value={img.id}>
                          {img.fileUrl.split("/").pop() ?? img.id}
                        </option>
                      ))}
                    </select>
                    {item.imageId && (
                      <a
                        href={evidence.find((img) => img.id === item.imageId)?.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={cn("text-[11px]", LINK)}
                      >
                        View
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* inspector sign-off (PRD §2) */}
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("px-4 py-3", BAR)}>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[#181b1e]">
            <PenLine size={15} strokeWidth={2} className="text-[#5b6166]" /> Inspector sign-off
          </h3>
        </div>
        <div className="p-4">
          {insp.signedAt ? (
            <p className="flex items-center gap-2 text-[13px] text-[#15803d]">
              <ClipboardCheck size={15} strokeWidth={2} />
              Signed off by {insp.signatureName || insp.signedBy} ·{" "}
              {fmtInTz(insp.signedAt, tz, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          ) : canInspect ? (
            <div className="space-y-2">
              <p className={cn("text-[12px]", MUTED)}>
                Attest that this inspection is complete and accurate. Type your name to sign.
              </p>
              <div className="flex gap-2">
                <input
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  placeholder="Your full name"
                  className={cn("h-9 flex-1 px-3 text-[13px]", INPUT)}
                />
                <button
                  onClick={sign}
                  disabled={!signName.trim() || !allComplete}
                  className={cn(
                    "h-9 px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-50",
                    BTN_PRIMARY,
                  )}
                >
                  <PenLine size={14} strokeWidth={2} /> Sign off
                </button>
              </div>
              {!allComplete && (
                <p className={cn("text-[11px]", MUTED)}>
                  Complete all checklist items before signing off.
                </p>
              )}
            </div>
          ) : (
            <p
              className={cn(
                "flex items-center gap-2 rounded-md border border-[#dbdfe3] bg-[#eef1f4] px-3 py-2 text-[12px]",
                MUTED,
              )}
            >
              <Lock size={13} strokeWidth={2} /> Switch to the Inspector role to complete and
              sign the checklist.
            </p>
          )}
        </div>
      </section>

      {/* per-runway results */}
      <div className="space-y-4">
        {runways.map(({ runway, issues }) => (
          <section key={runway.id} className={cn("overflow-hidden rounded-md", CARD)}>
            <div className={cn("flex items-center justify-between px-4 py-3", BAR)}>
              <h3 className="text-[13px] font-semibold text-[#181b1e]">
                {runway.name}{" "}
                <span className={cn("font-mono text-[12px]", MUTED)}>{runway.designation}</span>
              </h3>
              <p className={cn("text-[12px]", MUTED)}>
                {issues.length} issue{issues.length === 1 ? "" : "s"}
              </p>
            </div>
            {issues.length === 0 ? (
              <p className={cn("px-4 py-3 text-[13px]", MUTED)}>No issues found.</p>
            ) : (
              <ul className="divide-y divide-[#dbdfe3]">
                {issues.map((i) => {
                  const d = DECISION[i.status];
                  return (
                    <li key={i.id}>
                      <Link
                        href={`/issue/${i.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[#eef1f4]"
                      >
                        <span
                          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[i.severity])}
                        />
                        <span className="text-[13px] text-[#181b1e]">{CATEGORY[i.category]}</span>
                        {i.zone && (
                          <span className={cn("text-[12px]", MUTED)}>{i.zone}</span>
                        )}
                        <span className="ml-auto flex items-center gap-3">
                          <span className={cn("font-mono text-[12px] tabular-nums", MUTED)}>
                            {pct(i.confidence)}
                          </span>
                          <Badge tone={d.tone}>{d.label}</Badge>
                          <ArrowUpRight size={13} strokeWidth={2} className="text-[#9aa1a6]" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
