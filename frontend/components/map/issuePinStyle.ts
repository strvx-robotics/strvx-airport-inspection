import type { IssueCandidate, IssueStatus, Runway, Severity, Ticket, TicketStatus } from "@/lib/types";
import { CATEGORY, DECISION, SEVERITY, TICKET_STATUS } from "@/lib/ui";

export const SEV_RADIUS: Record<Severity, number> = { low: 4, medium: 5, high: 6.5, critical: 8 };
export const SEV_COLOR: Record<Severity, string> = {
  low: "#9aa1a6",
  medium: "#caa44e",
  high: "#c8762f",
  critical: "#b23b32",
};

const COMPLETE_GREEN = "#2f8f5b";
const IN_PROGRESS_BLUE = "#1a73e8";

export function ticketForIssue(issue: IssueCandidate, tickets: Ticket[]): Ticket | undefined {
  return tickets.find((t) => t.id === issue.ticketId) ?? tickets.find((t) => t.issueId === issue.id);
}

export function ticketStatusLabel(status?: TicketStatus): string | undefined {
  return status ? TICKET_STATUS[status]?.label ?? status : undefined;
}

export function issuePinProperties(runway: Runway, issue: IssueCandidate, ticket?: Ticket) {
  const color = SEV_COLOR[issue.severity];
  const pending = issue.status === "pending" || issue.status === "manual_review";
  const issueRejected = issue.status === "rejected";
  const ticketStatus = ticket?.status;
  const completed = ticketStatus === "repaired" || ticketStatus === "closed";
  const ticketRejected = ticketStatus === "rejected";
  const inProgress = ticketStatus === "in_progress";
  const sent = ticketStatus === "sent";
  const ticketLabel = ticketStatusLabel(ticketStatus);

  let fill = issueRejected || ticketRejected ? "#c7cdd2" : pending ? "#fbfcfd" : color;
  let stroke = issueRejected || ticketRejected ? "#9aa1a6" : pending ? color : "#fbfcfd";
  let strokeWidth = pending ? 2.5 : 1.5;
  let alpha = issueRejected || ticketRejected ? 0.55 : 0.95;
  let radius = SEV_RADIUS[issue.severity];

  if (!pending && !issueRejected && !ticketRejected) {
    if (completed) {
      fill = COMPLETE_GREEN;
      stroke = "#fbfcfd";
      strokeWidth = ticketStatus === "repaired" ? 3 : 2.25;
      radius += ticketStatus === "repaired" ? 1.25 : 0.5;
      alpha = ticketStatus === "closed" ? 0.82 : 1;
    } else if (inProgress) {
      fill = IN_PROGRESS_BLUE;
      stroke = "#fbfcfd";
      strokeWidth = 2.25;
      radius += 0.75;
    } else if (sent) {
      fill = color;
      stroke = "#fbfcfd";
    }
  }

  return {
    severity: issue.severity,
    status: issue.status as IssueStatus,
    ticketStatus,
    radius,
    fill,
    stroke,
    strokeWidth,
    alpha,
    label: [
      runway.name,
      CATEGORY[issue.category],
      SEVERITY[issue.severity].label,
      DECISION[issue.status].label,
      ticketLabel,
    ].filter(Boolean).join(" · "),
  };
}
