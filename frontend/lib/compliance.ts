// Part 139 compliance-record helpers, shared by the report renderers (PDF + HTML,
// server-side) and the inspection/issue UI (client). No React or DB imports so it
// is safe to use in any context.
//
// "Conditions found" and "corrective action taken" are rendered per discrepancy.
// Each value is the inspector's saved override when present, otherwise a default
// derived from existing data (finding description + linked work-order status).

import type { IssueCandidate, Ticket } from "./types";

const WO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent to maintenance",
  in_progress: "In progress",
  repaired: "Repaired · awaiting reinspection",
  reinspected: "Reinspected · ready to close",
  closed: "Closed",
  rejected: "Rejected",
};

/** Full work-order status label (never abbreviated/truncated). */
export function workOrderStatusLabel(status: string): string {
  return WO_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

/** "Conditions found": inspector override if set, else the finding description. */
export function discrepancyConditionsFound(issue: IssueCandidate): string {
  const override = issue.conditionsFound?.trim();
  if (override) return override;
  return (
    issue.draft?.trim() ||
    issue.inspectorNotes?.trim() ||
    issue.modelNotes?.trim() ||
    issue.aiDraftText?.trim() ||
    "Condition flagged during inspection."
  );
}

/** "Corrective action taken": inspector override if set, else derived from the
 *  linked work order's status. Open work orders read as in-progress (per the
 *  Part 139 daily-ops model — the inspection is final, remediation continues). */
export function discrepancyCorrectiveAction(issue: IssueCandidate, ticket?: Ticket): string {
  const override = issue.correctiveAction?.trim();
  if (override) return override;
  const notes = ticket?.maintenanceNotes?.trim();
  const tail = notes ? ` ${notes}` : "";
  if (ticket) {
    const wo = ticket.id;
    switch (ticket.status) {
      case "closed":
        return `Repaired and verified on reinspection; work order ${wo} closed.${tail}`;
      case "reinspected":
        return `Repair verified on reinspection; work order ${wo} ready to close.${tail}`;
      case "repaired":
        return `Repaired by maintenance; awaiting reinspection (work order ${wo}).${tail}`;
      case "in_progress":
        return `Corrective action in progress (work order ${wo}).${tail}`;
      case "sent":
        return `Work order ${wo} issued to maintenance.${tail}`;
      case "rejected":
        return `Work order ${wo} rejected; no corrective action taken.${tail}`;
      default:
        return `Work order ${wo} — ${workOrderStatusLabel(ticket.status)}.${tail}`;
    }
  }
  switch (issue.status) {
    case "pending":
      return "Pending inspector review — no corrective action assigned yet.";
    case "manual_review":
      return "Escalated for manual review.";
    case "rejected":
      return "Dismissed on review — not a reportable discrepancy.";
    default:
      return "No corrective action recorded.";
  }
}

/** A discrepancy's corrective action is complete only once its work order closes. */
export function correctiveActionComplete(ticket?: Ticket): boolean {
  return ticket?.status === "closed";
}

/** The signed inspector attestation statement (14 CFR §139.327 self-inspection). */
export const ATTESTATION_STATEMENT =
  "I certify that I am authorized to conduct this self-inspection of the airport " +
  "movement and safety areas, that the checklist results and discrepancies recorded " +
  "in this report reflect the actual conditions found, and that corrective action " +
  "has been initiated or completed as documented herein, in accordance with 14 CFR " +
  "§139.327.";

export interface InspectionCompleteness {
  checklistComplete: boolean;
  signed: boolean;
  hasCompletionTime: boolean;
  /** All gates satisfied → the report is a final compliance record. */
  isFinal: boolean;
  /** Human-readable list of what's still missing (empty when final). */
  missing: string[];
}

/** Evaluate whether an inspection report is a complete, final compliance record:
 *  every checklist item answered, attestation signed, and a completion time set. */
export function evaluateCompleteness(args: {
  checklistTotal: number;
  checklistAnswered: number;
  signedAt?: string | null;
  attestation?: boolean | null;
  completedAt?: string | null;
}): InspectionCompleteness {
  const checklistComplete = args.checklistTotal > 0 && args.checklistAnswered >= args.checklistTotal;
  const signed = Boolean(args.signedAt) && Boolean(args.attestation);
  const hasCompletionTime = Boolean(args.completedAt);
  const missing: string[] = [];
  if (!checklistComplete) {
    const remaining = Math.max(0, args.checklistTotal - args.checklistAnswered);
    missing.push(
      args.checklistTotal === 0
        ? "checklist not started"
        : `${remaining} checklist item${remaining === 1 ? "" : "s"} unanswered`,
    );
  }
  if (!signed) missing.push("inspector attestation unsigned");
  if (!hasCompletionTime) missing.push("completion time not recorded");
  return { checklistComplete, signed, hasCompletionTime, isFinal: missing.length === 0, missing };
}
