"use client";

import { forwardRef } from "react";
import { ArrowUpRight, ImageOff, X } from "lucide-react";
import Badge from "@/components/Badge";
import type { IssueCandidate, Ticket } from "@/lib/types";
import { CATEGORY, SEVERITY, DECISION, TICKET_STATUS, confidenceBand, pct } from "@/lib/ui";
import { BTN_PRIMARY, EYEBROW } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

/**
 * Floating triage card for a clicked issue pin. The parent owns positioning: it
 * writes `left`/`top` straight to this card's DOM node (forwarded ref) on every
 * map move, so the card tracks its pin without re-rendering React — same pattern
 * Floating preview card for map-side issue triage (photo + facts) without
 * leaving the map; "Open issue" navigates to the full review screen.
 */
export const IssuePreviewCard = forwardRef<
  HTMLDivElement,
  {
    issue: IssueCandidate;
    ticket?: Ticket;
    runwayName: string;
    onOpen: () => void;
    onClose: () => void;
  }
>(function IssuePreviewCard({ issue, ticket, runwayName, onOpen, onClose }, ref) {
  const band = confidenceBand(issue.confidence);
  return (
    <div
      ref={ref}
      className="issue-preview-card pointer-events-auto absolute z-20 w-60 overflow-visible rounded-md border border-[#c7cdd2] bg-[#fbfcfd] shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {/* captured frame — the single most useful triage signal */}
      <div className="relative h-28 w-full overflow-hidden rounded-t-md bg-[#0f1214]">
        {issue.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={issue.imageUrl}
            alt={`${CATEGORY[issue.category]} on ${runwayName}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#5b6166]">
            <ImageOff size={20} strokeWidth={1.8} />
          </div>
        )}
        <button
          onClick={onClose}
          title="Close"
          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/45 text-white/90 transition-colors hover:bg-black/70"
        >
          <X size={14} strokeWidth={2.4} />
        </button>
      </div>

      <div className="space-y-2 p-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-semibold text-[#181b1e]">{CATEGORY[issue.category]}</p>
          <span className={cn(EYEBROW, "shrink-0")}>{runwayName}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={SEVERITY[issue.severity].tone}>{SEVERITY[issue.severity].label}</Badge>
          <Badge tone={DECISION[issue.status].tone}>{DECISION[issue.status].label}</Badge>
          {ticket && <Badge tone={TICKET_STATUS[ticket.status].tone}>{TICKET_STATUS[ticket.status].label}</Badge>}
          <Badge tone={band.tone}>{`${band.label} · ${pct(issue.confidence)}`}</Badge>
        </div>
        <button onClick={onOpen} className={cn(BTN_PRIMARY, "w-full px-3 py-1.5 text-[12px]")}>
          Open issue <ArrowUpRight size={14} strokeWidth={2.2} />
        </button>
      </div>

      {/* little stem pointing down at the pin */}
      <div className="issue-preview-stem absolute h-2 w-2 rotate-45 border-[#c7cdd2] bg-[#fbfcfd]" />
    </div>
  );
});
