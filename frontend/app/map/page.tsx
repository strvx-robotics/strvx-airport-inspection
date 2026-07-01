"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Map as MapIcon } from "lucide-react";
import * as api from "@/lib/api";
import type { Overview } from "@/lib/api";
import type { ZoneLayer } from "@/components/map/AirportMap";
import type { IssueCandidate, SecurityAlert, Ticket } from "@/lib/types";
import { fmtInTz } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EYEBROW, MUTED } from "@/lib/vstyle";

const AirportMap = dynamic(() => import("@/components/map/AirportMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-md bg-[#f3f5f7]" />,
});

function resolveInspectionId(scope: string, overview: Overview): string | undefined {
  if (scope === "all") return undefined;
  if (scope === "current") return overview.inspection?.id;
  return scope;
}

function inspectionOptions(overview: Overview): { id: string; label: string }[] {
  return (overview.inspections ?? []).map((insp) => ({
    id: insp.id,
    label: fmtInTz(insp.scheduledTime, overview.airport.timezone, { dateStyle: "medium", timeStyle: "short" }),
  }));
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="h-8 w-48 animate-pulse rounded-md bg-[#f3f5f7]" />
          <div className="min-h-0 flex-1 animate-pulse rounded-md bg-[#f3f5f7]" />
        </div>
      }
    >
      <MapPageContent />
    </Suspense>
  );
}

function MapPageContent() {
  const searchParams = useSearchParams();
  const autoDrawZone = useMemo(() => {
    if (searchParams.get("drawZone") !== "1") return undefined;
    const zoneId = searchParams.get("zoneId") ?? undefined;
    return { zoneId };
  }, [searchParams]);
  const [layers, setLayers] = useState<ZoneLayer[] | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlert[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [inspectionScope, setInspectionScope] = useState("current");
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  const loadData = useCallback(async (scope: string) => {
    setRefreshing(true);
    try {
      const ov = await api.getOverview();
      setOverview(ov);
      const inspectionId = resolveInspectionId(scope, ov);

      const baseLayers: ZoneLayer[] = ov.zones.map(({ zone }) => ({
        zone,
        issues: [],
        zones: [],
      }));
      setLayers(baseLayers);

      const [ticketList, securityAlertList, ...zoneResults] = await Promise.all([
        api.listTickets().catch(() => [] as Ticket[]),
        api.listSecurityAlerts(ov.airport.id).catch(() => [] as SecurityAlert[]),
        ...baseLayers.map(({ zone }) => api.getZone(zone.id, inspectionId)),
      ]);

      const scopedTickets = inspectionId
        ? ticketList.filter((t) =>
            zoneResults.some((r) => r.issues.some((i) => i.id === t.issueId)),
          )
        : ticketList;
      setTickets(scopedTickets);
      setSecurityAlerts(securityAlertList);

      setLayers(
        baseLayers.map((layer, index) => ({
          ...layer,
          issues: zoneResults[index]?.issues ?? [],
        })),
      );
      setLastSynced(new Date());
    } catch {
      setLayers([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(inspectionScope);
  }, [inspectionScope, loadData]);

  const handleIssueUpdated = useCallback((updated: IssueCandidate, ticket?: Ticket) => {
    setLayers(
      (current) =>
        current?.map((layer) =>
          layer.zone.id === updated.zoneId
            ? {
                ...layer,
                issues: layer.issues.map((i) => (i.id === updated.id ? updated : i)),
              }
            : layer,
        ) ?? current,
    );
    if (ticket) {
      setTickets((prev) => {
        const rest = prev.filter((t) => t.id !== ticket.id);
        return [...rest, ticket];
      });
    } else if (updated.ticketId) {
      void api.listTickets().then(setTickets).catch(() => undefined);
    }
  }, []);

  const allIssues = layers?.flatMap((l) => l.issues) ?? [];
  const issueCount = allIssues.length;
  const pendingReview = allIssues.filter(
    (i) => i.status === "pending" || i.status === "manual_review",
  ).length;

  const airportLabel = overview ? `${overview.airport.name} · ${overview.airport.code}` : "";
  const airportCenter = useMemo(() => {
    if (!overview?.airport.centerLat || !overview?.airport.centerLng) return undefined;
    return { lat: overview.airport.centerLat, lng: overview.airport.centerLng };
  }, [overview?.airport.centerLat, overview?.airport.centerLng]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapIcon size={16} strokeWidth={2} className="text-[#5b6166]" />
          <h1 className="text-[14px] font-semibold text-[#181b1e]">Airport map</h1>
          <span className={cn("ml-1", EYEBROW)}>{airportLabel}</span>
        </div>
        <p className={cn("flex flex-wrap items-center gap-3 text-[12px]", MUTED)}>
          <span>{issueCount} issue{issueCount === 1 ? "" : "s"}</span>
          {pendingReview > 0 && <span>· {pendingReview} need review</span>}
          {lastSynced && <span>· synced {lastSynced.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        </p>
      </div>
      <div className="min-h-0 flex-1">
        {layers === null ? (
          <div className="h-full w-full animate-pulse rounded-md bg-[#f3f5f7]" />
        ) : (
          <AirportMap
            layers={layers}
            tickets={tickets}
            securityAlerts={securityAlerts}
            inspections={overview ? inspectionOptions(overview) : []}
            airportId={overview?.airport.id ?? ""}
            airportCenter={airportCenter}
            currentInspectionId={overview?.inspection?.id}
            inspectionScope={inspectionScope}
            onInspectionScopeChange={setInspectionScope}
            onRefresh={() => void loadData(inspectionScope)}
            refreshing={refreshing}
            onIssueUpdated={handleIssueUpdated}
            autoDrawZone={autoDrawZone}
          />
        )}
      </div>
    </div>
  );
}
