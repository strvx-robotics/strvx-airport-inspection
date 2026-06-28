"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Flag, ScanSearch, X } from "lucide-react";
import Badge from "@/components/Badge";
import DiffView from "@/components/DiffView";
import RejectModal from "@/components/RejectModal";
import RunwayImage from "@/components/RunwayImage";
import { useIssueDetail, useStore } from "@/lib/store";
import {
  CATEGORY,
  DECISION,
  SEVERITIES,
  SEVERITY,
  confidenceBand,
  pct,
} from "@/lib/ui";
import { ISSUE_CATEGORIES } from "@/lib/types";
import type { IssueCategory, RejectionReason, Severity } from "@/lib/types";
import {
  BTN,
  BTN_DANGER,
  BTN_PRIMARY,
  CARD,
  DOT,
  EYEBROW,
  H2,
  INPUT,
  LINK,
} from "@/lib/vstyle";
import { cn } from "@/lib/cn";

export default function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { issue, loading } = useIssueDetail(id);
  const { role, approveIssue, rejectIssue, manualReview, editIssue, runways } =
    useStore();

  // Local editable state — instant typing; persisted to the API on blur/change.
  const [category, setCategory] = useState<IssueCategory>("fod");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [showReject, setShowReject] = useState(false);

  // Sync local state when the issue first loads (or the id changes).
  useEffect(() => {
    if (!issue) return;
    setCategory(issue.category);
    setSeverity(issue.severity);
    setDraft(issue.draft);
    setNotes(issue.inspectorNotes);
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!issue) {
    if (loading)
      return (
        <div className="mx-auto max-w-6xl px-6 py-6">
          <p className="text-[13px] text-[#737a7f]">Loading issue…</p>
        </div>
      );
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-6 py-6">
        <p className="text-[13px] text-[#9aa1a6]">Issue not found.</p>
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
  const editable = !decided && canReview;

  const persist = (patch: {
    category?: IssueCategory;
    severity?: Severity;
    draft?: string;
    notes?: string;
  }) => {
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

  const selectClass = cn(
    "w-full px-2 py-2",
    INPUT,
    "disabled:cursor-not-allowed disabled:opacity-60",
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <Link
        href={`/runway/${issue.runwayId}`}
        className={cn("h-8 px-2.5 text-[12px]", BTN)}
      >
        <ChevronLeft size={14} strokeWidth={2} /> {runway?.name ?? "Runway"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={EYEBROW}>Valanor · Issue review</p>
          <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
            <ScanSearch size={17} strokeWidth={2} /> {CATEGORY[issue.category]}
          </h1>
          <p className="mt-1 font-mono text-[12px] text-[#737a7f]">
            {runway?.name} · {issue.zone} · {issue.id.toUpperCase()}
          </p>
        </div>
        <Badge tone={DECISION[issue.status].tone}>
          {DECISION[issue.status].label}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* left — the evidence */}
        <div className="space-y-3">
          <RunwayImage bbox={issue.bbox} label={CATEGORY[issue.category]} src={issue.imageUrl} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={band.tone}>{band.label}</Badge>
            <span className="font-mono text-[12px] text-[#9aa1a6]">
              {pct(issue.confidence)} model confidence
            </span>
            {issue.gps && (
              <span className="ml-auto font-mono text-[11px] text-[#737a7f]">
                {issue.gps.lat.toFixed(4)}, {issue.gps.lng.toFixed(4)}
              </span>
            )}
          </div>
        </div>

        {/* right — the review card */}
        <div className={cn("space-y-4 rounded-md p-4", CARD)}>
          <Field label="Category">
            <select
              value={category}
              disabled={!editable}
              onChange={(e) => {
                const next = e.target.value as IssueCategory;
                setCategory(next);
                persist({ category: next });
              }}
              className={selectClass}
            >
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY[c]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    DOT[severity],
                  )}
                />
                Severity
              </span>
            }
          >
            <select
              value={severity}
              disabled={!editable}
              onChange={(e) => {
                const next = e.target.value as Severity;
                setSeverity(next);
                persist({ severity: next });
              }}
              className={selectClass}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY[s].label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Suggested ticket — AI draft">
            <textarea
              value={draft}
              disabled={!editable}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => editable && persist({ draft })}
              rows={5}
              className={cn(
                "w-full px-3 py-2 leading-relaxed",
                INPUT,
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            />
          </Field>

          {/* Self-improvement: immutable AI draft vs. edited text (design §13). */}
          <DiffView aiDraftText={issue.aiDraftText} editedText={draft} />

          <Field label="Inspector notes">
            <textarea
              value={notes}
              disabled={!editable}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => editable && persist({ notes })}
              rows={2}
              placeholder="Optional…"
              className={cn(
                "w-full px-3 py-2",
                INPUT,
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            />
          </Field>

          {decided ? (
            <Resolved
              status={issue.status}
              ticketId={issue.ticketId}
              label={DECISION[issue.status].label}
            />
          ) : !canReview ? (
            <p className="rounded-md border border-[#262b2f] bg-[#0f1214] px-3 py-2 text-center text-[12px] text-[#9aa1a6]">
              Switch to the Inspector role to review this candidate.
            </p>
          ) : (
            <div className="space-y-2 pt-1">
              <button
                onClick={handleApprove}
                className={cn("h-9 w-full px-3 text-[12px]", BTN_PRIMARY)}
              >
                <Check size={14} strokeWidth={2} /> Approve &amp; create ticket
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowReject(true)}
                  className={cn("h-9 px-3 text-[12px]", BTN_DANGER)}
                >
                  <X size={14} strokeWidth={2} /> Reject
                </button>
                <button
                  onClick={() => void manualReview(issue.id).catch(() => undefined)}
                  className={cn("h-9 px-3 text-[12px]", BTN)}
                >
                  <Flag size={14} strokeWidth={2} /> Manual review
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showReject && (
        <RejectModal
          onCancel={() => setShowReject(false)}
          onConfirm={handleReject}
        />
      )}
    </div>
  );
}

function Resolved({
  status,
  ticketId,
  label,
}: {
  status: string;
  ticketId?: string;
  label: string;
}) {
  if (status === "approved" && ticketId) {
    return (
      <Link
        href={`/ticket/${ticketId}`}
        className={cn("h-9 w-full px-3 text-[12px]", BTN)}
      >
        View ticket {ticketId} <ChevronRight size={14} strokeWidth={2} />
      </Link>
    );
  }
  return (
    <p className="rounded-md border border-[#262b2f] bg-[#0f1214] px-3 py-2 text-center text-[12px] text-[#9aa1a6]">
      {label} — no ticket created.
    </p>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className={cn("block", EYEBROW)}>{label}</label>
      {children}
    </div>
  );
}
