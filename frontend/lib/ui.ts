// Presentation maps: domain value -> human label + badge tone.
import type { Tone } from "@/components/Badge";
import type {
  ChecklistResult,
  Issue,
  IssueCategory,
  IssueDecision,
  InspectionStatus,
  InspectionType,
  InspectionWindow,
  RejectionReason,
  Severity,
  Ticket,
  TicketStatus,
  UserRole,
} from "./types";

export const CATEGORY: Record<IssueCategory, string> = {
  fod: "Debris / FOD",
  pavement: "Pavement Damage",
  marking: "Runway Marking",
  lighting: "Lighting / Signage",
};

export const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

/** Human labels for the reject-modal RejectionReason dropdown (design §13). */
export const REJECTION_REASON: Record<RejectionReason, string> = {
  not_an_issue: "Not an issue",
  wrong_category: "Wrong category",
  duplicate: "Duplicate detection",
  not_actionable: "Not actionable",
  below_threshold: "Below action threshold",
  image_unclear: "Image unclear",
  already_known: "Already known / logged",
  other: "Other",
};

/** Role-switcher labels. */
export const ROLE: Record<UserRole, string> = {
  admin: "Admin",
  inspector: "Inspector",
  maintenance: "Maintenance",
};

/** Inspection-window labels for the admin schedule form. */
export const INSPECTION_WINDOW: Record<InspectionWindow, string> = {
  daylight: "Daylight",
  dusk_lit: "Dusk · lit",
};

/** Inspection-type labels (PRD §3). */
export const INSPECTION_TYPE: Record<InspectionType, { label: string; tone: Tone }> = {
  daily: { label: "Daily", tone: "blue" },
  unusual: { label: "Unusual condition", tone: "amber" },
  accident: { label: "Accident / incident", tone: "red" },
};

/** Daily-checklist result labels + tones (PRD §6). */
export const CHECKLIST_RESULT: Record<ChecklistResult, { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "green" },
  fail: { label: "Fail", tone: "red" },
  na: { label: "N/A", tone: "gray" },
};

export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  low: { label: "Low", tone: "gray" },
  medium: { label: "Medium", tone: "amber" },
  high: { label: "High", tone: "amber" },
  critical: { label: "Critical", tone: "red" },
};

export const DECISION: Record<IssueDecision, { label: string; tone: Tone }> = {
  pending: { label: "Pending review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  manual_review: { label: "Manual review", tone: "purple" },
};

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: Tone }> =
  {
    draft: { label: "Draft", tone: "gray" },
    sent: { label: "Sent to maintenance", tone: "blue" },
    in_progress: { label: "In progress", tone: "blue" },
    repaired: { label: "Repaired · awaiting reinspection", tone: "amber" },
    reinspected: { label: "Reinspected · ready to close", tone: "purple" },
    closed: { label: "Closed", tone: "green" },
    rejected: { label: "Rejected", tone: "red" },
  };

/** Inspection lifecycle (PRD §8.1) → label + tone. Tones resolve to grayscale. */
export const INSPECTION_STATUS: Record<
  InspectionStatus,
  { label: string; tone: Tone }
> = {
  not_started: { label: "Not started", tone: "gray" },
  in_progress: { label: "In progress", tone: "blue" },
  processing: { label: "Processing", tone: "blue" },
  no_issues: { label: "No issues", tone: "green" },
  needs_review: { label: "Needs review", tone: "amber" },
  tickets_created: { label: "Tickets created", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};

/** PRD §10.4 confidence bands. */
export function confidenceBand(c: number): { label: string; tone: Tone } {
  if (c >= 0.85) return { label: "Likely issue", tone: "red" };
  if (c >= 0.6) return { label: "Needs review", tone: "amber" };
  return { label: "Low confidence", tone: "gray" };
}

export const pct = (c: number) => `${Math.round(c * 100)}%`;

/** Derived per-runway status shown on the dashboard. */
export function runwayStatus(
  runwayId: string,
  issues: Issue[],
  tickets: Ticket[],
): { label: string; tone: Tone } {
  const mine = issues.filter((i) => i.runwayId === runwayId);
  if (mine.length === 0) return { label: "No issues found", tone: "green" };
  if (mine.some((i) => i.decision === "pending" || i.decision === "manual_review"))
    return { label: "Issues need review", tone: "amber" };
  const myTickets = tickets.filter((t) => t.runwayId === runwayId);
  if (myTickets.length === 0)
    return { label: "Reviewed · no tickets", tone: "green" };
  if (myTickets.every((t) => t.status === "closed"))
    return { label: "Completed", tone: "green" };
  return { label: "Tickets open", tone: "blue" };
}
