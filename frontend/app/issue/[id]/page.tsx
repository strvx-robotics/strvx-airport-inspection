"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import Badge from "@/components/Badge";
import RunwayImage from "@/components/RunwayImage";
import { RUNWAYS } from "@/lib/seed";
import { useStore } from "@/lib/store";
import {
  CATEGORY,
  DECISION,
  SEVERITIES,
  SEVERITY,
  confidenceBand,
  pct,
} from "@/lib/ui";
import type { Severity } from "@/lib/types";

export default function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const {
    issue: getIssue,
    approveIssue,
    rejectIssue,
    manualReview,
    setNotes,
    setSeverity,
    setDraft,
  } = useStore();

  const issue = getIssue(id);
  if (!issue) {
    return (
      <div className="space-y-3">
        <p className="text-zinc-600">Issue not found.</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ‹ Back to overview
        </Link>
      </div>
    );
  }

  const runway = RUNWAYS.find((r) => r.id === issue.runwayId);
  const band = confidenceBand(issue.confidence);
  const decided = issue.decision !== "pending";

  return (
    <div className="space-y-6">
      <Link
        href={`/runway/${issue.runwayId}`}
        className="text-sm text-zinc-500 hover:text-zinc-800"
      >
        ‹ {runway?.name}
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
        <Badge tone={DECISION[issue.decision].tone}>
          {DECISION[issue.decision].label}
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
        </div>

        <div className="space-y-4">
          <Field label="Severity">
            <select
              value={issue.severity}
              disabled={decided}
              onChange={(e) => setSeverity(issue.id, e.target.value as Severity)}
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
              value={issue.draft}
              disabled={decided}
              onChange={(e) => setDraft(issue.id, e.target.value)}
              rows={5}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed disabled:bg-zinc-100 disabled:text-zinc-500"
            />
          </Field>

          <Field label="Inspector notes">
            <textarea
              value={issue.inspectorNotes}
              disabled={decided}
              onChange={(e) => setNotes(issue.id, e.target.value)}
              rows={2}
              placeholder="Optional…"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-100"
            />
          </Field>

          {decided ? (
            <Resolved issueId={issue.id} />
          ) : (
            <div className="space-y-2 pt-1">
              <button
                onClick={() => approveIssue(issue.id)}
                className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Approve &amp; create ticket
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => rejectIssue(issue.id)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => manualReview(issue.id)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Manual review
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Resolved({ issueId }: { issueId: string }) {
  const { issue: getIssue } = useStore();
  const issue = getIssue(issueId);
  if (!issue) return null;

  if (issue.decision === "approved" && issue.ticketId) {
    return (
      <Link
        href={`/ticket/${issue.ticketId}`}
        className="block w-full rounded-md bg-zinc-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-zinc-800"
      >
        View ticket {issue.ticketId} ›
      </Link>
    );
  }
  return (
    <p className="rounded-md bg-zinc-100 px-3 py-2 text-center text-sm text-zinc-600">
      {DECISION[issue.decision].label} — no ticket created.
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
