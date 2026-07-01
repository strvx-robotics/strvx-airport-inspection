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
  Ban,
  Layers,
} from "lucide-react";
import { MapPanel } from "./MapPanel";
import { PanelDropdown, type DropdownOption } from "./PanelDropdown";
import { cn } from "@/lib/cn";
import Badge from "@/components/Badge";
import RejectModal from "@/components/RejectModal";
import ZoneImage from "@/components/ZoneImage";
import { useStore } from "@/lib/store";
import * as api from "@/lib/api";
import type { IssueCandidate, IssueCategory, IssueStatus, RejectionReason, Zone, Severity, Ticket } from "@/lib/types";
import { CATEGORY, DECISION, SEVERITY, TICKET_STATUS, confidenceBand, pct } from "@/lib/ui";
import { BTN, BTN_DANGER, BTN_PRIMARY, INPUT, MUTED } from "@/lib/vstyle";
import type { IssueSortKey } from "./mapUtils";

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

/** Left-edge operations panel: map controls on top, the issue list merged into
 *  the lower half so it no longer floats over the map. */
export function MapToolbar({
  collapsed,
  onToggleCollapsed,
  issueCount,
  totalIssueCount,
  reviewQueueOnly,
  onToggleReviewQueue,
  inspectionScope,
  onInspectionScopeChange,
  inspections,
  currentInspectionId,
  onOpenKeepOut,
  keepOutActiveCount,
  canDrawZone,
  onDrawZone,
  onRefresh,
  refreshing,
  issues,
  zonesById,
  searchQuery,
  onSearchChange,
  sortKey,
  onSortChange,
  onSelectIssue,
  selectedIssueId,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  issueCount: number;
  totalIssueCount: number;
  reviewQueueOnly: boolean;
  onToggleReviewQueue: () => void;
  inspectionScope: string;
  onInspectionScopeChange: (scope: string) => void;
  inspections: { id: string; label: string }[];
  currentInspectionId?: string;
  onOpenKeepOut: () => void;
  keepOutActiveCount: number;
  canDrawZone: boolean;
  onDrawZone: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  issues: IssueCandidate[];
  zonesById: Record<string, Zone>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortKey: IssueSortKey;
  onSortChange: (key: IssueSortKey) => void;
  onSelectIssue: (issue: IssueCandidate) => void;
  selectedIssueId?: string | null;
}) {
  const inspectionOptions: DropdownOption[] = [
    { value: "current", label: `Current run${currentInspectionId ? "" : " (none)"}` },
    { value: "all", label: "All inspections" },
    ...inspections.map((insp) => ({ value: insp.id, label: insp.label })),
  ];
  const sortOptions: DropdownOption[] = [
    { value: "severity", label: "Sort: severity" },
    { value: "confidence", label: "Sort: confidence" },
    { value: "status", label: "Sort: status" },
    { value: "recent", label: "Sort: recent" },
  ];

  return (
    <MapPanel
      title="Map"
      icon={Crosshair}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      className="pointer-events-auto absolute left-3 top-3 z-10 w-64 max-h-[calc(100%-1.5rem)]"
    >
      <div className="flex shrink-0 flex-col gap-0.5 p-1.25">
        <p className="px-2 pb-1 pt-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#7a8288]">
          Inspection
        </p>
        <PanelDropdown
          label="Inspection scope"
          value={inspectionScope}
          options={inspectionOptions}
          onChange={onInspectionScopeChange}
          compact
        />
        <Divider />
        <p className="px-2 pb-1 pt-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#7a8288]">
          Map tools
        </p>
        <button
          type="button"
          onClick={onOpenKeepOut}
          title="Mark areas where drones must not fly"
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#3f4448] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f5b85]"
        >
          <Ban size={15} strokeWidth={2} className="text-[#b23b32]" />
          <span className="flex-1 font-mono text-[11px] tracking-wide">No-drone areas</span>
          {keepOutActiveCount > 0 && (
            <span className="rounded-full bg-[#b23b32] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[#fbfcfd]">
              {keepOutActiveCount}
            </span>
          )}
        </button>
        {canDrawZone && (
          <button
            type="button"
            onClick={onDrawZone}
            title="Draw the inspection boundary for a zone"
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#3f4448] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f5b85]"
          >
            <Layers size={15} strokeWidth={1.9} className="text-[#2f5b85]" />
            <span className="flex-1 font-mono text-[11px] tracking-wide">Draw boundary</span>
          </button>
        )}
        <Divider />
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#3f4448] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f5b85] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={15} strokeWidth={1.9} className={cn("text-[#5b6166]", refreshing && "animate-spin")} />
          <span className="font-mono text-[11px] tracking-wide">{refreshing ? "Syncing…" : "Refresh"}</span>
        </button>
      </div>

      {/* Issues — scrollable lower half, merged into the toolbar */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col border-t-2 border-[#c7cdd2] bg-[#f7f8f9]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
        <div className="flex items-center gap-2 px-2.5 pt-2">
          <ListChecks size={14} strokeWidth={2.1} className="text-[#5b6166]" />
          <span className="flex-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#7a8288]">
            Issues
          </span>
          <span className="font-mono text-[10px] tabular-nums text-[#6b7176]">
            {issueCount}/{totalIssueCount}
          </span>
        </div>
        <button
          onClick={onToggleReviewQueue}
          title="Show only issues awaiting review (pending + manual review)"
          className={cn(
            "mx-1.5 mt-1.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f5b85]",
            reviewQueueOnly
              ? "bg-[#d4ae50]/20 text-[#181b1e]"
              : "text-[#3f4448] hover:bg-[#eef1f4] hover:text-[#181b1e]",
          )}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#d4ae50]" />
          <span className="flex-1 font-mono text-[11px] tracking-wide">Review queue</span>
        </button>
        <div className="space-y-1.5 px-2 py-2">
          <div className="relative">
            <Search size={13} strokeWidth={2} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[#9aa1a6]" />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search ID or zone…"
              className={cn(INPUT, "h-7 w-full pl-7 pr-2 text-[11px]")}
            />
          </div>
          <PanelDropdown
            label="Issue sort"
            value={sortKey}
            options={sortOptions}
            onChange={(next) => onSortChange(next as IssueSortKey)}
            compact
          />
        </div>
        <div className="min-h-0 flex-1 divide-y divide-[#e4e8eb] overflow-y-auto border-t border-[#e4e8eb]">
          {issues.length === 0 ? (
            <p className="px-3 py-3 font-mono text-[11px] leading-snug text-[#9aa1a6]">No matching issues.</p>
          ) : (
            issues.map((issue) => {
              const zone = issue.zoneId ? zonesById[issue.zoneId] : undefined;
              return (
                <button
                  key={issue.id}
                  onClick={() => onSelectIssue(issue)}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[#eef1f4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#2f5b85]",
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
                      {[zone?.name, issue.boundary, issue.id.toUpperCase()].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </MapPanel>
  );
}

export function IssueDetailPanel({
  issue,
  zone,
  ticket,
  onClose,
  onOpen,
  onIssueUpdated,
}: {
  issue: IssueCandidate;
  zone?: Zone;
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
      <div className="pointer-events-auto absolute right-3 top-[21rem] z-10 w-[21rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-[#c7cdd2] bg-[#fbfcfd] shadow-lg md:top-[21rem]">
        <div className="flex items-center gap-2 border-b border-[#dbdfe3] px-3 py-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3f4448]">Detail</span>
          <button
            onClick={onClose}
            title="Close"
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[#6b7176] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e]"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          <div className="relative bg-[#101417]">
            <ZoneImage bbox={issue.bbox} src={issue.imageUrl} heightClass="h-40" />
          </div>
          <div className="space-y-3 p-3">
            <div>
              <p className="text-[13px] font-semibold text-[#181b1e]">{CATEGORY[issue.category]}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] tracking-wide text-[#6b7176]">
                {[zone?.name, issue.boundary, issue.id.toUpperCase()].filter(Boolean).join(" · ")}
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
  return <div className="mx-2 my-1.5 h-px bg-[#d8dde1]" />;
}

/** Bottom-right filters — severity, status, and category. */
export function MapLegend({
  severityFilter,
  statusFilter,
  categoryFilter,
  onToggleSeverity,
  onToggleStatus,
  onToggleCategory,
}: {
  severityFilter: Set<Severity>;
  statusFilter: Set<IssueStatus>;
  categoryFilter: Set<IssueCategory>;
  onToggleSeverity: (severity: Severity) => void;
  onToggleStatus: (status: IssueStatus) => void;
  onToggleCategory: (category: IssueCategory) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-3 right-3 z-10 overflow-hidden rounded-md border border-[#cfd5da] bg-[#f7f8f9]/96 shadow-[0_8px_24px_rgba(18,22,25,0.08)] backdrop-blur-sm",
        collapsed ? "w-auto" : "w-56",
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={cn(
          "flex items-center text-left transition-colors hover:bg-[#eef1f4]",
          collapsed ? "w-auto gap-1.5 px-2.5 py-2" : "w-full gap-2 border-b border-[#e4e8eb] px-3 py-2",
        )}
        aria-expanded={!collapsed}
      >
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[#3f4448]">Key</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={cn("text-[#6b7176] transition-transform", !collapsed && "ml-auto", collapsed && "-rotate-90")}
        />
      </button>
      {!collapsed && (
        <div className="space-y-2.5 px-3 py-3">
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
      <p className="pb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[#3f4448]">{title}</p>
      <div className="grid grid-cols-1 gap-y-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className={cn(
              "flex min-h-7 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[#eef1f4]",
              item.active ? "text-[#3f4448]" : "text-[#9aa1a6] opacity-60",
            )}
          >
            {item.dotClass && (
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", item.dotClass, !item.active && "grayscale")} />
            )}
            <span className="font-mono text-[11px] tracking-wide">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
