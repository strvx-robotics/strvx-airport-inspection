"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
    if (loading) return <p className="text-sm text-zinc-400">Loading issue…</p>;
    return (
      <div className="space-y-3">
        <p className="text-zinc-600">Issue not found.</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
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

  return (
    <div className="space-y-6">
      <Link
        href={`/runway/${issue.runwayId}`}
        className="text-sm text-zinc-500 hover:text-zinc-800"
      >
        ‹ {runway?.name ?? "Runway"}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {CATEGORY[issue.category]}
          </h1>
          <p className="text-sm text-zinc-500">
            {runway?.name} · {issue.zone} · {issue.id.toUpperCase()}
          </p>
        </div>
        <Badge tone={DECISION[issue.status].tone}>
          {DECISION[issue.status].label}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <RunwayImage bbox={issue.bbox} label={CATEGORY[issue.category]} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={band.tone}>{band.label}</Badge>
            <span className="text-sm text-zinc-500">
              {pct(issue.confidence)} model confidence
            </span>
            {issue.gps && (
              <span className="ml-auto font-mono text-xs text-zinc-400">
                {issue.gps.lat.toFixed(4)}, {issue.gps.lng.toFixed(4)}
              </span>
            )}
          </div>

          {/* Self-improvement: immutable AI draft vs. edited text (design §13). */}
          <DiffView aiDraftText={issue.aiDraftText} editedText={draft} />
        </div>

        <div className="space-y-4">
          <Field label="Category">
            <select
              value={category}
              disabled={!editable}
              onChange={(e) => {
                const next = e.target.value as IssueCategory;
                setCategory(next);
                persist({ category: next });
              }}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:bg-zinc-100 disabled:text-zinc-500"
            >
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY[c]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Severity">
            <select
              value={severity}
              disabled={!editable}
              onChange={(e) => {
                const next = e.target.value as Severity;
                setSeverity(next);
                persist({ severity: next });
              }}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:bg-zinc-100 disabled:text-zinc-500"
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
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed disabled:bg-zinc-100 disabled:text-zinc-500"
            />
          </Field>

          <Field label="Inspector notes">
            <textarea
              value={notes}
              disabled={!editable}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => editable && persist({ notes })}
              rows={2}
              placeholder="Optional…"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-100"
            />
          </Field>

          {decided ? (
            <Resolved
              status={issue.status}
              ticketId={issue.ticketId}
              label={DECISION[issue.status].label}
            />
          ) : !canReview ? (
            <p className="rounded-md bg-zinc-100 px-3 py-2 text-center text-sm text-zinc-500">
              Switch to the Inspector role to review this candidate.
            </p>
          ) : (
            <div className="space-y-2 pt-1">
              <button
                onClick={handleApprove}
                className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Approve &amp; create ticket
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowReject(true)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => void manualReview(issue.id).catch(() => undefined)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Manual review
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
        className="block w-full rounded-md bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-zinc-800"
      >
        View ticket {ticketId} ›
      </Link>
    );
  }
  return (
    <p className="rounded-md bg-zinc-100 px-3 py-2 text-center text-sm text-zinc-600">
      {label} — no ticket created.
    </p>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}
