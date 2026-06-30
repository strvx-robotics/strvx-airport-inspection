"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Crosshair,
  ListChecks,
  ChevronDown,
  X,
  ArrowUpRight,
  Flag,
  Check,
  RefreshCw,
  Search,
} from "lucide-react";
import { MapPanel } from "./MapPanel";
import { cn } from "@/lib/cn";
import Badge from "@/components/Badge";
import RejectModal from "@/components/RejectModal";
import RunwayImage from "@/components/RunwayImage";
import { useStore } from "@/lib/store";
import * as api from "@/lib/api";
import type { IssueCandidate, IssueCategory, IssueStatus, RejectionReason, Runway, Severity, Ticket } from "@/lib/types";
import type { RunwayOverview } from "@/lib/api";
import { CATEGORY, DECISION, SEVERITY, TICKET_STATUS, confidenceBand, pct } from "@/lib/ui";
import { BTN, BTN_DANGER, BTN_PRIMARY, INPUT, MUTED } from "@/lib/vstyle";
import { ticketForIssue, type IssueSortKey } from "./mapUtils";

export const LEGEND_SECTIONS = {
  severity: [
    { key: "critical", label: "Critical", dotClass: "bg-[#b23b32] ring-2 ring-[#b23b32]/25" },
    { key: "high", label: "High", dotClass: "bg-[#d07d2e]" },
    { key: "medium", label: "Medium", dotClass: "bg-[#d4ae50]" },
    { key: "low", label: "Low", dotClass: "bg-[#a7adb3]" },
  ],
  status: [
    { key: "pending", label: "Pending review", dotClass: "bg-[#d4ae50]" },
    { key: "manual_review", label: "Manual review", dotClass: "bg-[#8d78bd]" },
    { key: "approved", label: "Approved", dotClass: "bg-[#44b07f]" },
    { key: "rejected", label: "Rejected", dotClass: "bg-[#b23b32] ring-2 ring-[#b23b32]/25" },
  ],
} as const;

type VisibleLayerKey = never;
export type { VisibleLayerKey };
export type IssueFilters = {
  severities: Set<Severity>;
  statuses: Set<IssueStatus>;
  categories: Set<IssueCategory>;
};

const CATEGORY_FILTERS: IssueCategory[] = ["fod", "pavement", "marking", "lighting"];
const SEVERITY_FILTERS: Severity[] = ["critical", "high", "medium", "low"];
const STATUS_FILTERS: IssueStatus[] = ["pending", "manual_review", "approved", "rejected"];
export { CATEGORY_FILTERS, SEVERITY_FILTERS, STATUS_FILTERS };

/** Left-edge operations panel — satellite map has no drawn overlays. */
export function MapToolbar({
  collapsed,
  onToggleCollapsed,
  onRecenter,
  issueListOpen,
  onToggleIssueList,
  issueCount,
  totalIssueCount,
  reviewQueueOnly,
  onToggleReviewQueue,
  runways,
  runwayOverviews,
  focusedRunwayId,
  onFocusRunway,
  inspectionScope,
  onInspectionScopeChange,
  inspections,
  currentInspectionId,
  onRefresh,
  refreshing,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRecenter: () => void;
  issueListOpen: boolean;
  onToggleIssueList: () => void;
  issueCount: number;
  totalIssueCount: number;
  reviewQueueOnly: boolean;
  onToggleReviewQueue: () => void;
  runways: Runway[];
  runwayOverviews: RunwayOverview[];
  focusedRunwayId: string;
  onFocusRunway: (runwayId: string) => void;
  inspectionScope: string;
  onInspectionScopeChange: (scope: string) => void;
  inspections: { id: string; label: string }[];
  currentInspectionId?: string;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  return (
    <MapPanel
      title="Map"
      icon={Crosshair}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      className="pointer-events-auto absolute left-3 top-3 z-10 w-52"
    >
      <div className="flex flex-col gap-0.5 p-1.25">
        <p className="px-2 pb-1 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9aa1a6]">
          Review
        </p>
        <button
          onClick={onToggleIssueList}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
            issueListOpen
              ? "bg-[#181b1e] text-[#eef1f4]"
              : "text-[#3f4448] hover:bg-white/5 hover:text-[#181b1e]",
          )}
        >
          <ListChecks size={15} strokeWidth={2.1} className={issueListOpen ? "text-[#eef1f4]" : "text-[#5b6166]"} />
          <span className="flex-1 font-mono text-[11px] tracking-wide">Issue list</span>
          <span className="font-mono text-[10px] tabular-nums">{issueCount}/{totalIssueCount}</span>
        </button>
        <button
          onClick={onToggleReviewQueue}
          className={cn(
            "mt-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
            reviewQueueOnly
              ? "bg-[#d4ae50]/20 text-[#181b1e]"
              : "text-[#3f4448] hover:bg-white/5 hover:text-[#181b1e]",
          )}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#d4ae50]" />
          <span className="flex-1 font-mono text-[11px] tracking-wide">Review queue</span>
        </button>
        <Divider />
        <p className="px-2 pb-1 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9aa1a6]">
          Inspection
        </p>
        <select
          value={inspectionScope}
          onChange={(e) => onInspectionScopeChange(e.target.value)}
          className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded-md border border-[#c7cdd2] bg-[#fbfcfd] px-2 py-1.5 font-mono text-[11px] text-[#181b1e] focus:border-[#888f95] focus:outline-none"
        >
          <option value="current">Current run{currentInspectionId ? "" : " (none)"}</option>
          <option value="all">All inspections</option>
          {inspections.map((insp) => (
            <option key={insp.id} value={insp.id}>
              {insp.label}
            </option>
          ))}
        </select>
        {runwayOverviews.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1.5 pb-1">
            <button
              type="button"
              onClick={() => onFocusRunway("all")}
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-[9px] tracking-wide transition-colors",
                focusedRunwayId === "all"
                  ? "border-[#181b1e] bg-[#181b1e] text-[#eef1f4]"
                  : "border-[#c7cdd2] bg-[#fbfcfd] text-[#3f4448] hover:bg-[#eef1f4]",
              )}
            >
              All
            </button>
            {runwayOverviews.map(({ runway, pendingCount }) => (
              <button
                key={runway.id}
                type="button"
                onClick={() => onFocusRunway(runway.id)}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 font-mono text-[9px] tracking-wide transition-colors",
                  focusedRunwayId === runway.id
                    ? "border-[#181b1e] bg-[#181b1e] text-[#eef1f4]"
                    : "border-[#c7cdd2] bg-[#fbfcfd] text-[#3f4448] hover:bg-[#eef1f4]",
                )}
              >
                {runway.designation}
                {pendingCount > 0 ? ` · ${pendingCount}` : ""}
              </button>
            ))}
          </div>
        )}
        <Divider />
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#3f4448] transition-colors hover:bg-white/5 hover:text-[#181b1e] disabled:opacity-50"
        >
          <RefreshCw size={15} strokeWidth={1.9} className={cn("text-[#5b6166]", refreshing && "animate-spin")} />
          <span className="font-mono text-[11px] tracking-wide">{refreshing ? "Syncing…" : "Refresh"}</span>
        </button>
        <button
          onClick={onRecenter}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#3f4448] transition-colors hover:bg-white/5 hover:text-[#181b1e]"
        >
          <Crosshair size={15} strokeWidth={1.9} className="text-[#5b6166]" />
          <span className="font-mono text-[11px] tracking-wide">Recenter</span>
        </button>
      </div>
    </MapPanel>
  );
}

export function IssueListPanel({
  open,
  issues,
  runways,
  tickets,
  searchQuery,
  onSearchChange,
  sortKey,
  onSortChange,
  onToggle,
  onSelect,
  selectedIssueId,
}: {
  open: boolean;
  issues: IssueCandidate[];
  runways: Record<string, Runway>;
  tickets: Ticket[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortKey: IssueSortKey;
  onSortChange: (key: IssueSortKey) => void;
  onToggle: () => void;
  onSelect: (issue: IssueCandidate) => void;
  selectedIssueId?: string | null;
}) {
  return (
    <MapPanel
      title="Issues"
      icon={ListChecks}
      collapsed={!open}
      onToggle={onToggle}
      fill
      testId="map-issue-list-panel"
      className={cn("pointer-events-auto", open ? "flex min-h-0 flex-1 flex-col" : "shrink-0")}
    >
      <div className="shrink-0 space-y-0 border-b border-[#e4e8eb] px-2 py-2">
        <div className="relative">
          <Search size={13} strokeWidth={2} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[#9aa1a6]" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search ID, zone, runway…"
            className={cn(INPUT, "h-7 w-full pl-7 pr-2 text-[11px]")}
          />
        </div>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as IssueSortKey)}
          className={cn(INPUT, "mt-1.5 h-7 w-full px-2 text-[11px]")}
        >
          <option value="severity">Sort: severity</option>
          <option value="confidence">Sort: confidence</option>
          <option value="status">Sort: status</option>
          <option value="recent">Sort: recent</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-[#e4e8eb] overflow-y-auto">
        {issues.length === 0 ? (
          <p className="px-3 py-3 font-mono text-[11px] leading-snug text-[#9aa1a6]">No matching issues.</p>
        ) : (
          issues.map((issue) => {
            const runway = runways[issue.runwayId];
            const ticket = ticketForIssue(issue, tickets);
            return (
              <button
                key={issue.id}
                onClick={() => onSelect(issue)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[#eef1f4]",
                  selectedIssueId === issue.id && "bg-[#eef1f4]",
                )}
              >
                <span
                  className={cn(
                    "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                    LEGEND_SECTIONS.severity.find((s) => s.key === issue.severity)?.dotClass,
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-[#181b1e]">
                    {CATEGORY[issue.category]}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] tracking-wide text-[#6b7176]">
                    {[runway?.name, issue.zone, issue.id.toUpperCase()].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    <Badge tone={SEVERITY[issue.severity].tone}>{SEVERITY[issue.severity].label}</Badge>
                    <Badge tone={DECISION[issue.status].tone}>{DECISION[issue.status].label}</Badge>
                    {ticket && (
                      <Badge tone={TICKET_STATUS[ticket.status].tone}>{TICKET_STATUS[ticket.status].label}</Badge>
                    )}
                    <Badge tone="gray">{pct(issue.confidence)}</Badge>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
      <p className="shrink-0 border-t border-[#e4e8eb] px-3 py-2 font-mono text-[9px] leading-snug text-[#9aa1a6]">
        ↑↓ navigate · Enter full review · Esc close
      </p>
    </MapPanel>
  );
}

export function IssueDetailPanel({
  issue,
  runway,
  ticket,
  onClose,
  onOpen,
  onIssueUpdated,
}: {
  issue: IssueCandidate;
  runway?: Runway;
  ticket?: Ticket;
  onClose: () => void;
  onOpen: () => void;
  onIssueUpdated: (issue: IssueCandidate, ticket?: Ticket) => void;
}) {
  const router = useRouter();
  const { role, rejectIssue, manualReview } = useStore();
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);

  const band = confidenceBand(issue.confidence);
  const canReview = (role === "inspector" || role === "admin") && issue.status === "pending";
  const decided = issue.status !== "pending";

  const handleApprove = async () => {
    setBusy(true);
    try {
      const { issue: updated, ticket: newTicket } = await api.approveIssue(issue.id);
      onIssueUpdated(updated, newTicket);
      router.push(`/ticket/${newTicket.id}`);
    } catch {
      /* api error */
    } finally {
      setBusy(false);
    }
  };

  const handleReject = (reason: RejectionReason, note?: string) => {
    setShowReject(false);
    setBusy(true);
    void rejectIssue(issue.id, reason, note)
      .then(() => onIssueUpdated({ ...issue, status: "rejected", rejectionReason: reason, rejectionNote: note }))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const handleManualReview = () => {
    setBusy(true);
    void manualReview(issue.id)
      .then(() => onIssueUpdated({ ...issue, status: "manual_review" }))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div
        data-testid="map-issue-detail-panel"
        className="pointer-events-auto flex max-h-[65%] min-h-0 shrink flex-col overflow-hidden rounded-md border border-[#c7cdd2] bg-[#fbfcfd] shadow-lg"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[#dbdfe3] px-3 py-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3f4448]">Detail</span>
          <button
            onClick={onClose}
            title="Close"
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[#6b7176] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e]"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative bg-[#101417]">
            <RunwayImage bbox={issue.bbox} src={issue.imageUrl} heightClass="h-24" />
          </div>
          <div className="space-y-3 p-3">
            <div>
              <p className="text-[13px] font-semibold text-[#181b1e]">{CATEGORY[issue.category]}</p>
              <p className="mt-0.5 break-words font-mono text-[10px] tracking-wide text-[#6b7176]">
                {[runway?.name, issue.zone, issue.id.toUpperCase()].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={SEVERITY[issue.severity].tone}>{SEVERITY[issue.severity].label}</Badge>
              <Badge tone={DECISION[issue.status].tone}>{DECISION[issue.status].label}</Badge>
              {ticket && (
                <Link href={`/ticket/${ticket.id}`}>
                  <Badge tone={TICKET_STATUS[ticket.status].tone}>WO · {TICKET_STATUS[ticket.status].label}</Badge>
                </Link>
              )}
              <Badge tone={band.tone}>{`${band.label} · ${pct(issue.confidence)}`}</Badge>
            </div>
            {issue.modelNotes && (
              <p className="text-[12px] leading-relaxed text-[#5b6166]">{issue.modelNotes}</p>
            )}
            {issue.draft && (
              <p className={cn("rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-2.5 py-2 text-[11px] leading-relaxed", MUTED)}>
                {issue.draft}
              </p>
            )}
            {canReview && (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowReject(true)}
                  className={cn("h-8 px-2 text-[11px]", BTN_DANGER)}
                >
                  <X size={13} strokeWidth={2} /> Reject
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleManualReview}
                  className={cn("h-8 px-2 text-[11px]", BTN)}
                >
                  <Flag size={13} strokeWidth={2} /> Manual
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleApprove()}
                  className={cn("col-span-2 h-8 px-2 text-[11px]", BTN_PRIMARY)}
                >
                  <Check size={13} strokeWidth={2} /> Approve & create ticket
                </button>
              </div>
            )}
            {decided && !ticket && (
              <p className="font-mono text-[10px] text-[#6b7176]">Review complete — open issue for full history.</p>
            )}
            <button
              onClick={onOpen}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-[#c7cdd2] bg-[#fbfcfd] px-3 py-2 text-[12px] font-semibold text-[#181b1e] transition-colors hover:bg-[#eef1f4]"
            >
              Full review <ArrowUpRight size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
      {showReject && <RejectModal onCancel={() => setShowReject(false)} onConfirm={handleReject} />}
    </>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-white/8" />;
}

/** Bottom-right filters — severity, status, and category. */
export function MapLegend({
  collapsed,
  onToggleCollapsed,
  severityFilter,
  statusFilter,
  categoryFilter,
  onToggleSeverity,
  onToggleStatus,
  onToggleCategory,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  severityFilter: Set<Severity>;
  statusFilter: Set<IssueStatus>;
  categoryFilter: Set<IssueCategory>;
  onToggleSeverity: (severity: Severity) => void;
  onToggleStatus: (status: IssueStatus) => void;
  onToggleCategory: (category: IssueCategory) => void;
}) {
  return (
    <div
      data-testid="map-key"
      className="pointer-events-auto absolute bottom-3 right-3 z-20 w-[34rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-[#cfd5da] bg-[#f7f8f9]/96 shadow-[0_8px_24px_rgba(18,22,25,0.08)] backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex w-full items-center gap-2 border-b border-[#e4e8eb] px-3 py-2 text-left transition-colors hover:bg-[#eef1f4]"
        aria-expanded={!collapsed}
      >
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3f4448]">Key</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={cn("ml-auto text-[#6b7176] transition-transform", collapsed && "-rotate-90")}
        />
      </button>
      {!collapsed && (
        <div className="grid max-h-[40vh] grid-cols-1 gap-3 overflow-y-auto overflow-x-hidden px-3 py-2.5 sm:grid-cols-3">
          <LegendFilterGroup
            title="Severity"
            items={SEVERITY_FILTERS.map((severity) => ({
              key: severity,
              label: SEVERITY[severity].label,
              dotClass: LEGEND_SECTIONS.severity.find((item) => item.key === severity)?.dotClass,
              active: severityFilter.has(severity),
              onClick: () => onToggleSeverity(severity),
            }))}
          />
          <LegendFilterGroup
            title="Status"
            items={STATUS_FILTERS.map((status) => ({
              key: status,
              label: DECISION[status].label,
              dotClass: LEGEND_SECTIONS.status.find((item) => item.key === status)?.dotClass,
              active: statusFilter.has(status),
              onClick: () => onToggleStatus(status),
            }))}
          />
          <LegendFilterGroup
            title="Category"
            items={CATEGORY_FILTERS.map((category) => ({
              key: category,
              label: CATEGORY[category],
              active: categoryFilter.has(category),
              onClick: () => onToggleCategory(category),
            }))}
          />
        </div>
      )}
    </div>
  );
}

function LegendFilterGroup({
  title,
  items,
}: {
  title: string;
  items: {
    key: string;
    label: string;
    dotClass?: string;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <div>
      <p className="pb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[#3f4448]">{title}</p>
      <div className="grid grid-cols-1 gap-y-0.5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className={cn(
              "flex min-h-6 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[#eef1f4]",
              item.active ? "text-[#3f4448]" : "text-[#9aa1a6] opacity-60",
            )}
          >
            {item.dotClass && (
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", item.dotClass, !item.active && "grayscale")} />
            )}
            <span className="whitespace-nowrap font-mono text-[11px] tracking-wide">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
