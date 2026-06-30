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
import Badge, { type Tone } from "@/components/Badge";
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
  SEVERITY,
  SPECIAL_TRIGGER,
  pct,
} from "@/lib/ui";
import { CHECKLIST_RESULTS, type ChecklistResult } from "@/lib/types";
import { evaluateCompleteness } from "@/lib/compliance";
import { cn } from "@/lib/cn";
import { CheckCircle2, CircleDashed } from "lucide-react";
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

const REVIEW_STATUSES = new Set(["pending", "manual_review"]);
const ACTIVE_TICKET_STATUSES = new Set([
  "draft",
  "sent",
  "in_progress",
  "repaired",
  "reinspected",
]);

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

function summarizeRunway(entry: api.InspectionReport["runways"][number]) {
  const reviewCount = entry.issues.filter((issue) => REVIEW_STATUSES.has(issue.status)).length;
  const approvedCount = entry.issues.filter((issue) => issue.status === "approved").length;
  const rejectedCount = entry.issues.filter((issue) => issue.status === "rejected").length;
  const openTickets = entry.tickets.filter((ticket) => ACTIVE_TICKET_STATUSES.has(ticket.status)).length;
  const closedTickets = entry.tickets.filter((ticket) => ticket.status === "closed").length;

  const state: { label: string; tone: Tone; priority: number } =
    reviewCount > 0
      ? {
          label: `${pluralize(reviewCount, "finding")} awaiting review`,
          tone: "amber",
          priority: 0,
        }
      : openTickets > 0
        ? {
            label: `${pluralize(openTickets, "ticket")} active`,
            tone: "blue",
            priority: 1,
          }
        : entry.issues.length > 0
          ? {
              label: "Reviewed",
              tone: "green",
              priority: 2,
            }
          : {
              label: "Clear",
              tone: "green",
              priority: 3,
            };

  return { ...entry, ...state, reviewCount, approvedCount, rejectedCount, openTickets, closedTickets };
}

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
  const completed = checklist.filter((item) => item.result).length;
  const allComplete = checklist.length > 0 && completed === checklist.length;
  const remainingChecklist = Math.max(0, checklist.length - completed);
  // Is the report a complete, final compliance record (checklist answered +
  // attestation signed + completion time)? Drives the export-readiness indicator.
  const completeness = evaluateCompleteness({
    checklistTotal: checklist.length,
    checklistAnswered: completed,
    signedAt: insp.signedAt,
    attestation: insp.attestation,
    completedAt: insp.completedAt,
  });
  const exportBlockedTitle = completeness.isFinal
    ? "Final compliance record export is available."
    : `Export blocked: ${completeness.missing.join(", ")}. Complete the checklist and sign the inspector attestation first.`;
  const runwaySummaries = runways
    .map(summarizeRunway)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.reviewCount - a.reviewCount ||
        b.openTickets - a.openTickets ||
        b.issues.length - a.issues.length ||
        a.runway.name.localeCompare(b.runway.name),
    );
  const findingRunways = runwaySummaries.filter((entry) => entry.issues.length > 0);
  const clearRunways = runwaySummaries.filter((entry) => entry.issues.length === 0);
  const runwaysWithFindings = runwaySummaries.filter((entry) => entry.issues.length > 0).length;
  const runwaysWithAttention = runwaySummaries.filter(
    (entry) => entry.reviewCount > 0 || entry.openTickets > 0,
  ).length;
  const reviewQueue = runwaySummaries.reduce((sum, entry) => sum + entry.reviewCount, 0);
  const activeTickets = runwaySummaries.reduce((sum, entry) => sum + entry.openTickets, 0);
  const reviewedIssues = runwaySummaries.reduce(
    (sum, entry) => sum + entry.approvedCount + entry.rejectedCount,
    0,
  );
  const objective = !allComplete
    ? {
        title: "Finish the inspection checklist",
        detail: `${pluralize(remainingChecklist, "checklist item")} still need a response before sign-off unlocks.`,
      }
    : !insp.signedAt
      ? {
          title: "Capture inspector sign-off",
          detail: "Checklist is complete. Record the inspector attestation to finalize this pass.",
        }
      : reviewQueue > 0
        ? {
            title: "Work the findings queue",
            detail: `${pluralize(reviewQueue, "candidate")} still require review across ${pluralize(runwaysWithAttention, "runway")}.`,
          }
        : activeTickets > 0
          ? {
              title: "Track active remediation",
              detail: `${pluralize(activeTickets, "ticket")} remain open from this inspection.`,
            }
          : totals.issues === 0
            ? {
                title: "Inspection is clear",
                detail: `All ${pluralize(runways.length, "runway")} were inspected with no findings recorded.`,
              }
            : {
                title: "Inspection record is in good shape",
                detail: "Checklist, sign-off, and runway findings are all documented.",
              };
  const workflowSteps = [
    {
      label: "Checklist",
      value: checklist.length === 0 ? "Not required" : allComplete ? "Complete" : `${remainingChecklist} remaining`,
      dot: checklist.length === 0 ? "bg-[#9aa1a6]" : allComplete ? "bg-[#15803d]" : "bg-[#caa44e]",
    },
    {
      label: "Sign-off",
      value: insp.signedAt ? "Recorded" : allComplete ? "Ready now" : "Blocked",
      dot: insp.signedAt ? "bg-[#15803d]" : allComplete ? "bg-[#2f5b85]" : "bg-[#9aa1a6]",
    },
    {
      label: "Findings queue",
      value:
        reviewQueue > 0
          ? `${reviewQueue} to review`
          : activeTickets > 0
            ? `${activeTickets} active`
            : "Clear",
      dot:
        reviewQueue > 0 ? "bg-[#caa44e]" : activeTickets > 0 ? "bg-[#2f5b85]" : "bg-[#15803d]",
    },
  ];
  const summaryMetrics = [
    {
      label: "Checklist",
      value: checklist.length === 0 ? "N/A" : `${completed}/${checklist.length}`,
      hint: checklist.length === 0 ? "No self-check items on this pass" : allComplete ? "Ready for sign-off" : `${remainingChecklist} remaining`,
    },
    {
      label: "Runways scanned",
      value: String(runways.length),
      hint:
        runwaysWithFindings > 0
          ? `${pluralize(runwaysWithFindings, "runway")} produced findings`
          : "No findings recorded",
    },
    {
      label: "Awaiting review",
      value: String(reviewQueue),
      hint:
        reviewQueue > 0
          ? `Across ${pluralize(runwaysWithAttention, "runway")}`
          : "No unresolved candidates",
    },
    {
      label: "Tickets open",
      value: String(totals.ticketsOpen),
      hint:
        totals.ticketsOpen > 0
          ? `${totals.ticketsCompleted} completed`
          : totals.ticketsCompleted > 0
            ? `${totals.ticketsCompleted} completed`
            : "No maintenance queue yet",
    },
  ];
  const summaryText =
    totals.issues === 0
      ? "This pass is clear. No runway findings or work orders were generated."
      : `${pluralize(totals.issues, "finding")} were recorded across ${pluralize(
          runwaysWithFindings,
          "runway",
        )}. ${reviewQueue > 0 ? `${pluralize(reviewQueue, "candidate")} still need review.` : `${pluralize(reviewedIssues, "finding")} have already been dispositioned.`}`;

  const setResult = (itemKey: string, result: ChecklistResult) => {
    const item = checklist.find((entry) => entry.itemKey === itemKey);
    void api
      .saveChecklistItem(id, itemKey, result, item?.notes, item?.imageId ?? undefined)
      .then((next) => setDetail((current) => (current ? { ...current, checklist: next } : current)))
      .catch(() => undefined);
  };
  const setNotes = (itemKey: string, notes: string) => {
    const item = checklist.find((entry) => entry.itemKey === itemKey);
    if (!item?.result || notes === item.notes) return;
    void api
      .saveChecklistItem(id, itemKey, item.result, notes, item.imageId ?? undefined)
      .then((next) => setDetail((current) => (current ? { ...current, checklist: next } : current)))
      .catch(() => undefined);
  };
  const setEvidence = (itemKey: string, imageId: string | null) => {
    const item = checklist.find((entry) => entry.itemKey === itemKey);
    if (!item?.result) return;
    void api
      .saveChecklistItem(id, itemKey, item.result, item.notes, imageId ?? undefined)
      .then((next) => setDetail((current) => (current ? { ...current, checklist: next } : current)))
      .catch(() => undefined);
  };
  const sign = () => {
    if (!signName.trim()) return;
    void api.signInspection(id, signName.trim()).then(() => refresh()).catch(() => undefined);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/logs" className={cn("h-8 pl-2 pr-3 text-[12px]", BTN)}>
          <ChevronLeft size={15} strokeWidth={2} /> Inspection log
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            title={
              completeness.isFinal
                ? "All checklist items answered and the inspector attestation is signed. The PDF is a final compliance record."
                : `Not yet a final record: ${completeness.missing.join(", ")}. Export is blocked until this inspection is signed.`
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium",
              completeness.isFinal
                ? "border-[#bfe0cb] bg-[#eef7f1] text-[#2c6b46]"
                : "border-[#ecdcb9] bg-[#fbf6ec] text-[#8a6516]",
            )}
          >
            {completeness.isFinal ? (
              <CheckCircle2 size={13} strokeWidth={2.2} />
            ) : (
              <CircleDashed size={13} strokeWidth={2.2} />
            )}
            {completeness.isFinal ? "Final record — ready to download" : "Draft — not final yet"}
          </span>
          {completeness.isFinal ? (
            <>
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
            </>
          ) : (
            <>
              <span
                aria-disabled="true"
                title={exportBlockedTitle}
                className={cn("h-8 cursor-not-allowed px-3 text-[12px] opacity-50", BTN)}
              >
                Export CSV
              </span>
              <span
                aria-disabled="true"
                title={exportBlockedTitle}
                className={cn("h-8 cursor-not-allowed px-3 text-[12px] opacity-50", BTN)}
              >
                <Download size={14} strokeWidth={2} /> Download PDF
              </span>
              <span
                aria-disabled="true"
                title={exportBlockedTitle}
                className={cn("h-8 cursor-not-allowed px-3 text-[12px] opacity-50", BTN)}
              >
                Open HTML report <ArrowUpRight size={14} strokeWidth={2} />
              </span>
            </>
          )}
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.95fr)]">
        <div className={cn("overflow-hidden rounded-md", CARD)}>
          <div className="border-b border-[#dbdfe3] bg-[linear-gradient(135deg,#f8fafb_0%,#eef1f4_100%)] px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={EYEBROW}>
                  {airport.name} · {airport.code}
                </p>
                <h2 className={cn("mt-2 flex items-center gap-2", H2)}>
                  <ScrollText size={17} strokeWidth={2} className="text-[#5b6166]" />
                  {fmtInTz(insp.scheduledTime, tz, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </h2>
                <p className={cn("mt-2 text-[13px] leading-6", MUTED)}>
                  {INSPECTION_WINDOW[insp.window]} ·{" "}
                  {fmtInTz(insp.scheduledTime, tz, { hour: "2-digit", minute: "2-digit" })}
                  {insp.type === "special" && insp.trigger
                    ? ` · ${SPECIAL_TRIGGER[insp.trigger].label}`
                    : ""}
                  {insp.reason ? ` · ${insp.reason}` : ""}
                </p>
                <p className="mt-3 max-w-2xl text-[13px] leading-6 text-[#3f4448]">{summaryText}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={typeBadge.tone}>{typeBadge.label}</Badge>
                <Badge tone={status.tone}>{status.label}</Badge>
                <Badge tone={insp.signedAt ? "green" : "gray"}>
                  {insp.signedAt ? "Signed" : "Awaiting sign-off"}
                </Badge>
              </div>
            </div>
          </div>

          <dl className="grid gap-px bg-[#dbdfe3] sm:grid-cols-2 xl:grid-cols-4">
            {summaryMetrics.map((metric) => (
              <div key={metric.label} className={METRIC_CELL}>
                <dt className={EYEBROW}>{metric.label}</dt>
                <dd className="mt-1 font-mono text-[20px] tabular-nums text-[#181b1e]">
                  {metric.value}
                </dd>
                <p className={cn("mt-1 text-[11px] leading-5", MUTED)}>{metric.hint}</p>
              </div>
            ))}
          </dl>
        </div>

        <section className={cn("self-start overflow-hidden rounded-md lg:sticky lg:top-6", CARD)}>
          <div className={cn("px-4 py-3", BAR)}>
            <p className={EYEBROW}>Inspection objective</p>
            <h3 className="mt-1 text-[15px] font-semibold text-[#181b1e]">{objective.title}</h3>
            <p className={cn("mt-2 text-[12px] leading-5", MUTED)}>{objective.detail}</p>
          </div>

          <div className="space-y-4 p-4">
            <ul className="space-y-2 rounded-md border border-[#dbdfe3] bg-[#f7f9fa] p-3">
              {workflowSteps.map((step) => (
                <li key={step.label} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="flex items-center gap-2 text-[#181b1e]">
                    <span className={cn("h-2 w-2 rounded-full", step.dot)} />
                    {step.label}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#5b6166]">
                    {step.value}
                  </span>
                </li>
              ))}
            </ul>

            <div className="rounded-md border border-[#dbdfe3] bg-[#f3f5f7] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-[#181b1e]">Inspector sign-off</p>
                {insp.signedAt && <Badge tone="green">Recorded</Badge>}
              </div>

              {insp.signedAt ? (
                <p className="mt-3 flex items-center gap-2 text-[13px] text-[#15803d]">
                  <ClipboardCheck size={15} strokeWidth={2} />
                  Signed by {insp.signatureName || insp.signedBy} ·{" "}
                  {fmtInTz(insp.signedAt, tz, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              ) : canInspect ? (
                <div className="mt-3 space-y-2">
                  <p className={cn("text-[12px] leading-5", MUTED)}>
                    Attest that this inspection is complete and accurate. Sign-off is enabled once the checklist is fully answered.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
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
                      {pluralize(remainingChecklist, "checklist item")} still need a response.
                    </p>
                  )}
                </div>
              ) : (
                <p
                  className={cn(
                    "mt-3 flex items-center gap-2 rounded-md border border-[#dbdfe3] bg-[#eef1f4] px-3 py-2 text-[12px]",
                    MUTED,
                  )}
                >
                  <Lock size={13} strokeWidth={2} /> Switch to the Inspector role to complete and
                  sign the checklist.
                </p>
              )}
            </div>

            <div className="grid gap-px overflow-hidden rounded-md border border-[#dbdfe3] bg-[#dbdfe3] sm:grid-cols-2">
              <div className="bg-[#fbfcfd] px-3 py-2.5">
                <p className={EYEBROW}>Evidence linked</p>
                <p className="mt-1 font-mono text-[18px] tabular-nums text-[#181b1e]">
                  {evidence.length}
                </p>
              </div>
              <div className="bg-[#fbfcfd] px-3 py-2.5">
                <p className={EYEBROW}>Tickets total</p>
                <p className="mt-1 font-mono text-[18px] tabular-nums text-[#181b1e]">
                  {totals.tickets}
                </p>
              </div>
            </div>
          </div>
        </section>
      </section>

      {checklist.length > 0 && (
        <section className={cn("overflow-hidden rounded-md", CARD)}>
          <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", BAR)}>
            <div>
              <p className={EYEBROW}>Required before sign-off</p>
              <h3 className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-[#181b1e]">
                <ClipboardCheck size={15} strokeWidth={2} className="text-[#5b6166]" />
                Daily self-inspection checklist
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={allComplete ? "green" : "amber"}>
                {allComplete ? "Complete" : `${remainingChecklist} remaining`}
              </Badge>
              <p className={cn("font-mono text-[12px] tabular-nums", MUTED)}>
                {completed} / {checklist.length}
              </p>
            </div>
          </div>

          <ul className="divide-y divide-[#dbdfe3]">
            {checklist.map((item) => (
              <li key={item.itemKey} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full border border-[#d6dbe0] bg-[#f3f5f7] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b7176]">
                      {CATEGORY[item.category]}
                    </span>
                    <p className="mt-2 text-[13px] font-medium text-[#181b1e]">{item.label}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
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

                <div
                  className={cn(
                    "mt-3 grid gap-2",
                    evidence.length > 0 && "md:grid-cols-[minmax(0,1fr)_minmax(12rem,14rem)]",
                  )}
                >
                  <input
                    defaultValue={item.notes}
                    disabled={!canInspect || !item.result}
                    onBlur={(e) => setNotes(item.itemKey, e.target.value)}
                    placeholder={item.result ? "Add a note…" : "Set a result to add a note"}
                    className={cn(
                      "h-9 w-full px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-50",
                      INPUT,
                    )}
                  />
                  {evidence.length > 0 && (
                    <select
                      id={`evidence-${item.itemKey}`}
                      value={item.imageId ?? ""}
                      disabled={!canInspect || !item.result}
                      onChange={(e) => setEvidence(item.itemKey, e.target.value || null)}
                      className={cn(
                        "h-9 min-w-[12rem] px-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-50",
                        INPUT,
                      )}
                    >
                      <option value="">Link evidence</option>
                      {evidence.map((img) => (
                        <option key={img.id} value={img.id}>
                          {img.fileUrl.split("/").pop() ?? img.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className={cn("text-[11px]", MUTED)} htmlFor={`evidence-${item.itemKey}`}>
                      Photo / video evidence
                    </label>
                    {item.imageId && (
                      <a
                        href={evidence.find((img) => img.id === item.imageId)?.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={cn("text-[11px]", LINK)}
                      >
                        View linked file
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className={EYEBROW}>Runway findings</p>
            <h3 className="mt-1 text-[18px] font-semibold text-[#181b1e]">Findings by runway</h3>
            <p className={cn("mt-2 max-w-3xl text-[13px] leading-6", MUTED)}>
              Runways with findings stay expanded in review order. Fully clear runways are tucked
              below so the working queue stays visible without losing audit coverage.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={reviewQueue > 0 ? "amber" : "green"}>
              {reviewQueue > 0 ? `${pluralize(reviewQueue, "finding")} to review` : "Review queue clear"}
            </Badge>
            <Badge tone={activeTickets > 0 ? "blue" : "green"}>
              {activeTickets > 0 ? `${pluralize(activeTickets, "ticket")} active` : "No active tickets"}
            </Badge>
          </div>
        </div>

        <div className="space-y-4">
          {findingRunways.map(
            ({
              runway,
              issues,
              tickets,
              label,
              tone,
              reviewCount,
              approvedCount,
              openTickets,
              closedTickets,
            }) => (
              <section key={runway.id} className={cn("overflow-hidden rounded-md", CARD)}>
                <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", BAR)}>
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#181b1e]">
                      {runway.name}{" "}
                      <span className={cn("font-mono text-[12px]", MUTED)}>{runway.designation}</span>
                    </h3>
                    <p className={cn("mt-1 text-[12px] leading-5", MUTED)}>
                      {issues.length === 0
                        ? "No findings were recorded on this runway during the selected pass."
                        : `${pluralize(issues.length, "finding")} logged. ${reviewCount > 0 ? `${pluralize(
                            reviewCount,
                            "finding",
                          )} still need review.` : "All findings have already been reviewed."}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone}>{label}</Badge>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#6b7176]">
                      {pluralize(issues.length, "issue")}
                    </span>
                  </div>
                </div>

                <dl className="grid gap-px border-b border-[#dbdfe3] bg-[#dbdfe3] sm:grid-cols-4">
                  <div className="bg-[#fbfcfd] px-4 py-2.5">
                    <dt className={EYEBROW}>Awaiting review</dt>
                    <dd className="mt-1 font-mono text-[17px] tabular-nums text-[#181b1e]">
                      {reviewCount}
                    </dd>
                  </div>
                  <div className="bg-[#fbfcfd] px-4 py-2.5">
                    <dt className={EYEBROW}>Approved</dt>
                    <dd className="mt-1 font-mono text-[17px] tabular-nums text-[#181b1e]">
                      {approvedCount}
                    </dd>
                  </div>
                  <div className="bg-[#fbfcfd] px-4 py-2.5">
                    <dt className={EYEBROW}>Active tickets</dt>
                    <dd className="mt-1 font-mono text-[17px] tabular-nums text-[#181b1e]">
                      {openTickets}
                    </dd>
                  </div>
                  <div className="bg-[#fbfcfd] px-4 py-2.5">
                    <dt className={EYEBROW}>Closed tickets</dt>
                    <dd className="mt-1 font-mono text-[17px] tabular-nums text-[#181b1e]">
                      {closedTickets}
                    </dd>
                  </div>
                </dl>

                {issues.length === 0 ? (
                  <p className={cn("px-4 py-4 text-[13px]", MUTED)}>No issues found.</p>
                ) : (
                  <ul className="space-y-2 p-3">
                    {issues.map((issue) => {
                      const decision = DECISION[issue.status];
                      const severity = SEVERITY[issue.severity];
                      const ticket = issue.ticketId
                        ? tickets.find((entry) => entry.id === issue.ticketId)
                        : undefined;
                      return (
                        <li key={issue.id}>
                          <Link
                            href={`/issue/${issue.id}`}
                            className="block rounded-md border border-[#dfe4e8] bg-[#f7f9fa] px-3 py-3 transition-colors hover:border-[#c7cdd2] hover:bg-[#eef1f4]"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[issue.severity])}
                                  />
                                  <span className="text-[13px] font-medium text-[#181b1e]">
                                    {CATEGORY[issue.category]}
                                  </span>
                                  {issue.zone && (
                                    <span className={cn("text-[12px]", MUTED)}>{issue.zone}</span>
                                  )}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Badge tone={severity.tone}>{severity.label}</Badge>
                                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#6b7176]">
                                    {pct(issue.confidence)} confidence
                                  </span>
                                  {ticket && (
                                    <span className="text-[11px] text-[#5b6166]">
                                      Ticket {ticket.id}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <Badge tone={decision.tone}>{decision.label}</Badge>
                                <ArrowUpRight size={13} strokeWidth={2} className="text-[#9aa1a6]" />
                              </div>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ),
          )}

          {clearRunways.length > 0 && (
            <details className={cn("overflow-hidden rounded-md", CARD)}>
              <summary className={cn("flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3", BAR)}>
                <span>
                  <span className={EYEBROW}>Audit trail</span>
                  <span className="mt-1 block text-[13px] font-semibold text-[#181b1e]">
                    Clear runways
                  </span>
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#6b7176]">
                  {pluralize(clearRunways.length, "runway")}
                </span>
              </summary>

              <div className="divide-y divide-[#dbdfe3]">
                {clearRunways.map(({ runway }) => (
                  <div
                    key={runway.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-[#181b1e]">
                        {runway.name}{" "}
                        <span className={cn("font-mono text-[12px]", MUTED)}>{runway.designation}</span>
                      </p>
                      <p className={cn("mt-1 text-[12px]", MUTED)}>
                        No findings were recorded on this runway during the selected pass.
                      </p>
                    </div>
                    <Badge tone="green">Clear</Badge>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}
