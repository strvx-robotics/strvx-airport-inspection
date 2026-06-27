// Domain types for the runway-inspection demo.
// Mirrors the PRD §11 data model, trimmed to what Phase 0 actually renders.

export type IssueCategory = "fod" | "pavement" | "marking" | "lighting";
export type Severity = "low" | "medium" | "high" | "critical";
export type IssueDecision = "pending" | "approved" | "rejected" | "manual_review";
export type TicketStatus =
  | "draft"
  | "sent"
  | "in_progress"
  | "repaired"
  | "closed"
  | "rejected";

/** Detection box as percentages of the image, so it scales with any container. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Runway {
  id: string;
  name: string;
  designation: string;
  length: string;
}

export interface Issue {
  id: string;
  runwayId: string;
  zone: string;
  category: IssueCategory;
  confidence: number; // 0–1
  severity: Severity;
  decision: IssueDecision;
  bbox: BBox;
  gps?: { lat: number; lng: number };
  draft: string; // LLM-drafted ticket text — the inspector edits/approves this
  inspectorNotes: string;
  ticketId?: string; // set once approved
}

export interface Ticket {
  id: string;
  issueId: string;
  runwayId: string;
  zone: string;
  category: IssueCategory;
  severity: Severity;
  description: string;
  status: TicketStatus;
  createdBy: string;
  assignedTo: string;
  maintenanceNotes: string;
}
