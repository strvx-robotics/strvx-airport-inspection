import type { IssueCandidate, Ticket } from "@/lib/types";

export function ticketForIssue(issue: IssueCandidate, tickets: Ticket[]): Ticket | undefined {
  return tickets.find((t) => t.id === issue.ticketId) ?? tickets.find((t) => t.issueId === issue.id);
}

export type IssueSortKey = "severity" | "confidence" | "status" | "recent";

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function sortIssues(issues: IssueCandidate[], sortKey: IssueSortKey): IssueCandidate[] {
  const sorted = [...issues];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "confidence":
        return b.confidence - a.confidence;
      case "status":
        return a.status.localeCompare(b.status);
      case "recent":
        return b.createdAt.localeCompare(a.createdAt);
      case "severity":
      default:
        return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    }
  });
  return sorted;
}

export function searchIssues(
  issues: IssueCandidate[],
  query: string,
  runways: Record<string, { name?: string }>,
): IssueCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return issues;
  return issues.filter((issue) => {
    const runway = runways[issue.runwayId];
    const haystack = [
      issue.id,
      issue.zone,
      runway?.name,
      issue.category,
      issue.draft,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
