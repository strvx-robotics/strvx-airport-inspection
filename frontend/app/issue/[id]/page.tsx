"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Flag, Printer, ScanSearch, X } from "lucide-react";
import Badge from "@/components/Badge";
import DiffView from "@/components/DiffView";
import RejectModal from "@/components/RejectModal";
import RunwayImage from "@/components/RunwayImage";
import Select, { type SelectOption } from "@/components/Select";
import { useIssueDetail, useStore } from "@/lib/store";
import { buildWorkOrder } from "@/lib/workOrder";
import { CATEGORY, DECISION, SEVERITIES, SEVERITY, confidenceBand, pct } from "@/lib/ui";
import { ISSUE_CATEGORIES } from "@/lib/types";
import type { IssueCandidate, IssueCategory, RejectionReason, Runway, Severity, Ticket } from "@/lib/types";
import { BAR, BTN, BTN_DANGER, BTN_PRIMARY, CARD, DOT, EYEBROW, H2, INPUT, LINK, MUTED } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

type Step = 1 | 2 | 3;
const STEP_META: Record<Step, { title: string; hint: string }> = {
  1: { title: "Detection", hint: "confirm the AI found a real defect" },
  2: { title: "Ticket", hint: "verify the work-order write-up" },
  3: { title: "Preview", hint: "confirm before dispatch to maintenance" },
};

const CATEGORY_OPTIONS: SelectOption<IssueCategory>[] = ISSUE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY[c] }));
const SEVERITY_OPTIONS: SelectOption<Severity>[] = SEVERITIES.map((s) => ({ value: s, label: SEVERITY[s].label }));

/** Provisional ticket built from the current (edited) issue state, so the work
 *  order can be derived/previewed before the real ticket exists. */
function previewTicket(issue: IssueCandidate, category: IssueCategory, severity: Severity, draft: string): Ticket {
  return {
    id: "PENDING",
    issueId: issue.id,
    runwayId: issue.runwayId,
    zone: issue.zone ?? "",
    category,
    severity,
    description: draft,
    status: "sent",
    createdBy: issue.createdBy ?? "Valanor Inspector",
    assignedTo: "Field Maintenance",
    maintenanceNotes: "",
    createdAt: issue.createdAt,
  };
}

export default function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { issue, loading } = useIssueDetail(id);
  const { role, approveIssue, rejectIssue, manualReview, editIssue, runways } = useStore();

  const [category, setCategory] = useState<IssueCategory>("fod");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [step, setStep] = useState<Step>(1);

  useEffect(() => {
    if (!issue) return;
    setCategory(issue.category);
    setSeverity(issue.severity);
    setDraft(issue.draft);
    setNotes(issue.inspectorNotes);
    setStep(1);
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!issue) {
    if (loading)
      return (
        <div className="mx-auto max-w-6xl px-6 py-6">
          <p className="text-[13px] text-[#6b7176]">Loading issue…</p>
        </div>
      );
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-6 py-6">
        <p className="text-[13px] text-[#5b6166]">Issue not found.</p>
        <Link href="/" className={LINK}>
          ‹ Back to overview
        </Link>
      </div>
    );
  }

  const runway = runways[issue.runwayId];
  const band = confidenceBand(issue.confidence);
  const decided = issue.status !== "pending";
  const canReview = role === "inspector" || role === "admin";
  const edited = draft.trim() !== (issue.aiDraftText ?? "").trim();
  const woFields = buildWorkOrder(previewTicket(issue, category, severity, draft), { ...issue, inspectorNotes: notes }, runway);

  const persist = (patch: { category?: IssueCategory; severity?: Severity; draft?: string; notes?: string }) => {
    void editIssue(issue.id, patch).catch(() => undefined);
  };

  const handleApprove = async () => {
    try {
      await editIssue(issue.id, { category, severity, draft, notes });
      const ticketId = await approveIssue(issue.id);
      if (ticketId) router.push(`/ticket/${ticketId}`);
    } catch {
      /* optimistic update already rolled back in the store */
    }
  };

  const handleReject = (reason: RejectionReason, note?: string) => {
    setShowReject(false);
    void rejectIssue(issue.id, reason, note).catch(() => undefined);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <Link href={`/runway/${issue.runwayId}`} className={cn("h-8 w-fit px-2.5 text-[12px]", BTN)}>
        <ChevronLeft size={14} strokeWidth={2} /> {runway?.name ?? "Runway"}
      </Link>

      {/* header box — matches the dashboard command strip */}
      <section className={cn("overflow-hidden rounded-md", CARD)}>
        <div className={cn("flex flex-wrap items-end justify-between gap-3 px-4 py-3", BAR)}>
          <div className="min-w-0">
            <p className={EYEBROW}>Valanor · Issue review</p>
            <h2 className={cn("mt-1 flex items-center gap-2", H2)}>
              <ScanSearch size={17} strokeWidth={2} /> {CATEGORY[issue.category]}
            </h2>
            <p className="mt-1 font-mono text-[12px] text-[#6b7176]">
              {[runway?.name, issue.zone, issue.id.toUpperCase()].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Badge tone={DECISION[issue.status].tone}>{DECISION[issue.status].label}</Badge>
        </div>
      </section>

      {decided ? (
        <DecidedView issue={issue} runway={runway} ticketId={issue.ticketId} />
      ) : !canReview ? (
        <p className={cn("rounded-md border-[#dbdfe3] bg-[#f3f5f7] px-4 py-3 text-center text-[13px] text-[#5b6166]", CARD)}>
          Switch to the Inspector role to review this candidate.
        </p>
      ) : (
        <section className={cn("overflow-hidden rounded-md", CARD)}>
          <div className={cn("flex items-center justify-between gap-3 px-4 py-2.5", BAR)}>
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-[#181b1e]">
              {STEP_META[step].title}
              <span className={cn("text-[12px] font-normal", MUTED)}>{STEP_META[step].hint}</span>
            </h3>
            <StepDots step={step} />
          </div>

          <div className="p-4">
            {step === 1 ? (
              <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
                <RunwayImage
                  bbox={issue.bbox}
                  label={CATEGORY[category]}
                  src={issue.imageUrl}
                  fit="contain"
                  heightClass="h-[300px] md:h-[440px]"
                />
                <div className="space-y-4">
                  <Field label="Category">
                    <Select
                      value={category}
                      options={CATEGORY_OPTIONS}
                      ariaLabel="Category"
                      onChange={(v) => {
                        setCategory(v);
                        persist({ category: v });
                      }}
                    />
                  </Field>
                  <Field
                    label={
                      <span className="flex items-center gap-1.5">
                        <span className={cn("inline-block h-2 w-2 rounded-full", DOT[severity])} /> Severity
                      </span>
                    }
                  >
                    <Select
                      value={severity}
                      options={SEVERITY_OPTIONS}
                      ariaLabel="Severity"
                      onChange={(v) => {
                        setSeverity(v);
                        persist({ severity: v });
                      }}
                    />
                  </Field>

                  <div className="space-y-1.5">
                    <span className={EYEBROW}>Model confidence</span>
                    <div className="flex items-center gap-2">
                      <Badge tone={band.tone}>{band.label}</Badge>
                      <span className="font-mono text-[13px] tabular-nums text-[#181b1e]">{pct(issue.confidence)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e4e8ec]">
                      <div
                        className="h-full rounded-full bg-[#181b1e]"
                        style={{ width: `${Math.round(issue.confidence * 100)}%` }}
                      />
                    </div>
                  </div>

                  {issue.gps && (
                    <p className="font-mono text-[11px] text-[#6b7176]">
                      {issue.gps.lat.toFixed(4)}, {issue.gps.lng.toFixed(4)}
                    </p>
                  )}
                </div>
              </div>
            ) : step === 2 ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className={cn("flex items-center justify-between", EYEBROW)}>
                    Ticket draft
                    <span className="font-mono text-[10px] normal-case tracking-normal text-[#9aa1a6]">
                      {edited ? "edited" : "AI-generated · editable"}
                    </span>
                  </label>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => persist({ draft })}
                    rows={5}
                    className={cn("w-full resize-y px-3 py-2 leading-relaxed", INPUT)}
                  />
                </div>

                {edited && <DiffView aiDraftText={issue.aiDraftText} editedText={draft} />}

                <Field label="Inspector notes">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => persist({ notes })}
                    rows={2}
                    placeholder="Optional — immediate action taken, context…"
                    className={cn("w-full resize-y px-3 py-2", INPUT)}
                  />
                </Field>

                {/* the full work order this draft becomes — auto-derived, for review */}
                <div className="space-y-2">
                  <p className={cn("flex flex-wrap items-baseline gap-x-2", EYEBROW)}>
                    Work order fields
                    <span className="text-[11px] font-normal normal-case tracking-normal text-[#9aa1a6]">
                      auto-derived from category &amp; severity
                    </span>
                  </p>
                  <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-[#e3e5e8] bg-[#e3e5e8] sm:grid-cols-2">
                    {woFields.map((f) => (
                      <div key={f.label} className="bg-white px-3 py-2.5">
                        <dt className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{f.label}</dt>
                        <dd className="mt-0.5 text-[13px] leading-relaxed text-[#3f4448]">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ) : (
              <WorkOrderSheet issue={issue} runway={runway} category={category} severity={severity} draft={draft} notes={notes} />
            )}
          </div>

          {/* step actions */}
          <div className="flex items-center justify-between gap-2 border-t border-[#dbdfe3] px-4 py-3">
            {step === 1 ? (
              <>
                <button onClick={() => setShowReject(true)} className={cn("h-9 px-3 text-[12px]", BTN_DANGER)}>
                  <X size={14} strokeWidth={2} /> False positive
                </button>
                <button onClick={() => setStep(2)} className={cn("h-9 px-4 text-[13px]", BTN_PRIMARY)}>
                  Confirm detection <ArrowRight size={15} strokeWidth={2} />
                </button>
              </>
            ) : step === 2 ? (
              <>
                <button onClick={() => setStep(1)} className={cn("h-9 px-3 text-[12px]", BTN)}>
                  <ChevronLeft size={14} strokeWidth={2} /> Back
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void manualReview(issue.id).catch(() => undefined)}
                    className={cn("h-9 px-3 text-[12px]", BTN)}
                  >
                    <Flag size={14} strokeWidth={2} /> Manual review
                  </button>
                  <button onClick={() => setStep(3)} className={cn("h-9 px-4 text-[13px]", BTN_PRIMARY)}>
                    Preview ticket <ArrowRight size={15} strokeWidth={2} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setStep(2)} className={cn("h-9 px-3 text-[12px]", BTN)}>
                  <ChevronLeft size={14} strokeWidth={2} /> Back
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={() => window.print()} className={cn("h-9 px-3 text-[12px]", BTN)}>
                    <Printer size={14} strokeWidth={2} /> Save PDF
                  </button>
                  <button onClick={handleApprove} className={cn("h-10 px-4 text-[13px]", BTN_PRIMARY)}>
                    <Check size={15} strokeWidth={2} /> Approve &amp; send to maintenance
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {showReject && <RejectModal onCancel={() => setShowReject(false)} onConfirm={handleReject} />}
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
      <span className="hidden sm:inline">Step {step} of 3</span>
      <span className="flex gap-1">
        {([1, 2, 3] as Step[]).map((n) => (
          <span
            key={n}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              n === step ? "bg-[#181b1e]" : n < step ? "bg-[#9aa1a6]" : "bg-[#d3d7da]",
            )}
          />
        ))}
      </span>
    </div>
  );
}

/** Print-styled work-order sheet — what maintenance receives. */
function WorkOrderSheet({
  issue,
  runway,
  category,
  severity,
  draft,
  notes,
}: {
  issue: IssueCandidate;
  runway?: Runway;
  category: IssueCategory;
  severity: Severity;
  draft: string;
  notes: string;
}) {
  const fields = buildWorkOrder(previewTicket(issue, category, severity, draft), { ...issue, inspectorNotes: notes }, runway);
  const sev = SEVERITY[severity];

  return (
    <div
      data-wo-sheet
      className="mx-auto max-w-[720px] overflow-hidden rounded-md border border-[#dbdfe3] bg-white shadow-[0_2px_10px_rgba(11,13,14,0.08)]"
    >
      <div className="flex items-start justify-between border-b-2 border-[#181b1e] px-6 py-5">
        <div>
          <p className="text-[18px] font-bold tracking-[0.22em] text-[#181b1e]">VALANOR</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#6b7176]">Airfield Inspection</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6b7176]">Maintenance work order</p>
          <p className="mt-1 font-mono text-[13px] font-semibold text-[#181b1e]">PENDING DISPATCH</p>
          <p className="font-mono text-[11px] text-[#9aa1a6]">{issue.id.toUpperCase()}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div>
          <h2 className="text-[20px] font-semibold text-[#181b1e]">{CATEGORY[category]}</h2>
          <p className="mt-1 text-[13px] text-[#5b6166]">{[runway?.name, issue.zone].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#181b1e] px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-[#181b1e]">
          <span className={cn("h-2 w-2 rounded-full", DOT[severity])} /> {sev.label} severity
        </span>
      </div>

      <div className="px-6 pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6b7176]">Description</p>
        <p className="mt-1 text-[14px] leading-relaxed text-[#181b1e]">{draft || "—"}</p>
      </div>

      <dl className="grid grid-cols-1 gap-px border-t border-[#e3e5e8] bg-[#e3e5e8] sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="bg-white px-6 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">{f.label}</dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-[#181b1e]">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-[#e3e5e8] px-6 py-4">
        <p className="font-mono text-[10px] leading-relaxed text-[#9aa1a6]">
          Generated by Valanor Airfield Inspection · Not yet dispatched — pending inspector approval.
        </p>
      </div>
    </div>
  );
}

/** Read-only view once a candidate is decided. */
function DecidedView({ issue, runway, ticketId }: { issue: IssueCandidate; runway?: Runway; ticketId?: string }) {
  if (issue.status === "approved") {
    return (
      <div className="space-y-4">
        <WorkOrderSheet
          issue={issue}
          runway={runway}
          category={issue.category}
          severity={issue.severity}
          draft={issue.draft}
          notes={issue.inspectorNotes}
        />
        {ticketId && (
          <Link
            href={`/ticket/${ticketId}`}
            className={cn("mx-auto flex h-10 max-w-[720px] items-center justify-center px-4 text-[13px]", BTN)}
          >
            View dispatched ticket {ticketId} <ChevronRight size={14} strokeWidth={2} />
          </Link>
        )}
      </div>
    );
  }
  return (
    <section className={cn("flex flex-col items-center gap-2 rounded-md p-8 text-center", CARD)}>
      <Badge tone={DECISION[issue.status].tone}>{DECISION[issue.status].label}</Badge>
      <p className="text-[13px] text-[#5b6166]">
        This candidate was {DECISION[issue.status].label.toLowerCase()} — no ticket was dispatched.
      </p>
    </section>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className={cn("block", EYEBROW)}>{label}</label>
      {children}
    </div>
  );
}
