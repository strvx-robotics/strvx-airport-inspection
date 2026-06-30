"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { IssueCandidate, IssueCategory, IssueStatus, KeepOutZone, LngLat, Runway, Severity, Ticket, Zone } from "@/lib/types";
import type { RunwayOverview } from "@/lib/api";
import { isMappable, runwayAnchor } from "@/lib/runwayGeom";
import { stationsFromPolygon } from "@/lib/keepOutGeom";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { basemapStyle } from "./mapStyle";
import { IssueDetailPanel, IssueListPanel, MapLegend, MapToolbar } from "./MapToolbar";
import { KeepOutMapTrigger, KeepOutZonesModal, type KeepOutStep } from "./KeepOutZonesModal";
import { InspectionZonesModal, type ZoneDrawStep } from "./InspectionZonesModal";
import {
  clearInspectionZoneDraftLayer,
  ensureInspectionZoneLayers,
  INSPECTION_ZONE_FILL_LAYER,
  updateInspectionZoneDraftLayer,
  updateInspectionZoneLayers,
} from "./inspectionZoneMapLayers";
import {
  clearKeepOutDraftLayer,
  ensureKeepOutLayers,
  updateKeepOutDraftLayer,
  updateKeepOutZoneLayers,
} from "./keepOutMapLayers";
import { searchIssues, sortIssues, ticketForIssue, type IssueSortKey } from "./mapUtils";
import { BTN, BTN_DANGER } from "@/lib/vstyle";

export interface RunwayLayer {
  runway: Runway;
  issues: IssueCandidate[];
  zones: unknown[];
}

const pos = (p: LngLat): [number, number] => [p.lng, p.lat];
const ALL_SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const ALL_STATUSES: IssueStatus[] = ["pending", "manual_review", "approved", "rejected"];
const ALL_CATEGORIES: IssueCategory[] = ["fod", "pavement", "marking", "lighting"];
const REVIEW_QUEUE_STATUSES: IssueStatus[] = ["pending", "manual_review"];

// The map opens on a zoomed-out overview (airfield + surrounding context) rather
// than tight on the runways. OVERVIEW_MAX_ZOOM caps how close the initial fit can
// get so small/stacked airports don't slam to street level.
const OVERVIEW_MAX_ZOOM = 12;
const OVERVIEW_PADDING = 80;

function buildBounds(layers: RunwayLayer[], airportCenter?: LngLat) {
  const bounds = new maplibregl.LngLatBounds();
  if (airportCenter) bounds.extend(pos(airportCenter));
  for (const { runway } of layers) {
    if (!isMappable(runway)) continue;
    const anchor = runwayAnchor(runway);
    if (anchor) bounds.extend(pos(anchor));
  }
  return bounds;
}

function paddedBounds(bounds: maplibregl.LngLatBounds, paddingDeg = 0.15) {
  if (bounds.isEmpty()) return bounds;
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return new maplibregl.LngLatBounds(
    [sw.lng - paddingDeg, sw.lat - paddingDeg],
    [ne.lng + paddingDeg, ne.lat + paddingDeg],
  );
}

function zonePopupPoint(map: maplibregl.Map, zone: Zone): { x: number; y: number } {
  const poly = zone.polygon;
  if (poly && poly.length >= 3) {
    const lat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    const lng = poly.reduce((s, p) => s + p.lng, 0) / poly.length;
    const pt = map.project([lng, lat]);
    return { x: pt.x, y: pt.y };
  }
  return { x: 0, y: 0 };
}

function minZoomForBounds(map: maplibregl.Map, bounds: maplibregl.LngLatBounds) {
  if (bounds.isEmpty()) return 0;
  const camera = map.cameraForBounds(bounds, { padding: 64 });
  const fitZoom = camera?.zoom;
  if (typeof fitZoom !== "number" || !Number.isFinite(fitZoom)) return 0;
  return Math.max(0, fitZoom - 4.5);
}

/** Satellite map with keep-out zone plotting; no issue/runway overlays. */
export default function AirportMap({
  layers,
  tickets,
  runwayOverviews,
  inspections,
  airportId,
  airportCenter,
  currentInspectionId,
  inspectionScope,
  onInspectionScopeChange,
  onRefresh,
  refreshing,
  onIssueUpdated,
  heightClass = "h-full",
  autoDrawZone,
}: {
  layers: RunwayLayer[];
  tickets: Ticket[];
  runwayOverviews: RunwayOverview[];
  inspections: { id: string; label: string }[];
  airportId: string;
  airportCenter?: LngLat;
  currentInspectionId?: string;
  inspectionScope: string;
  onInspectionScopeChange: (scope: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  onIssueUpdated: (issue: IssueCandidate, ticket?: Ticket) => void;
  heightClass?: string;
  autoDrawZone?: { runwayId?: string };
}) {
  const router = useRouter();
  const { role } = useStore();
  const canEditKeepOut = role === "inspector" || role === "admin";
  const canEditZones = role === "admin";
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const loadedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const [collapsed, setCollapsed] = useState(false);
  const [issueListOpen, setIssueListOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<IssueSortKey>("severity");
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(() => new Set(ALL_SEVERITIES));
  const [statusFilter, setStatusFilter] = useState<Set<IssueStatus>>(() => new Set(ALL_STATUSES));
  const [categoryFilter, setCategoryFilter] = useState<Set<IssueCategory>>(() => new Set(ALL_CATEGORIES));
  const [reviewQueueOnly, setReviewQueueOnly] = useState(false);
  const [focusedRunwayId, setFocusedRunwayId] = useState<string>("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  const [keepOutOpen, setKeepOutOpen] = useState(false);
  const [keepOutStep, setKeepOutStep] = useState<KeepOutStep>("list");
  const [keepOutZones, setKeepOutZones] = useState<KeepOutZone[]>([]);
  const [keepOutBusy, setKeepOutBusy] = useState(false);
  const [keepOutErr, setKeepOutErr] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [draftRunwayId, setDraftRunwayId] = useState("");
  const [plotPoints, setPlotPoints] = useState<LngLat[]>([]);

  const [zoneDrawOpen, setZoneDrawOpen] = useState(false);
  const [zoneDrawStep, setZoneDrawStep] = useState<ZoneDrawStep>("details");
  const [inspectionZones, setInspectionZones] = useState<Zone[]>([]);
  const [zonesReady, setZonesReady] = useState(false);
  const [zoneDrawBusy, setZoneDrawBusy] = useState(false);
  const [zoneDrawErr, setZoneDrawErr] = useState<string | null>(null);
  const [zoneDraftName, setZoneDraftName] = useState("");
  const [zoneDraftRunwayId, setZoneDraftRunwayId] = useState("");
  const [zonePlotPoints, setZonePlotPoints] = useState<LngLat[]>([]);
  const [zoneHover, setZoneHover] = useState<{ zone: Zone; x: number; y: number } | null>(null);
  const [zoneDrawLockRunwayId, setZoneDrawLockRunwayId] = useState<string | undefined>();
  const autoDrawStarted = useRef(false);
  const zoneHoverClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoneHoverPinned = useRef(false);

  const plotMode = keepOutOpen && keepOutStep === "plot";
  const zonePlotMode = zoneDrawOpen && zoneDrawStep === "plot";

  const allIssues = layers.flatMap(({ issues }) => issues);
  const runwayById = Object.fromEntries(layers.map((layer) => [layer.runway.id, layer.runway] as const));

  const filteredIssues = useMemo(() => {
    const filtered = allIssues.filter(
      (issue) =>
        severityFilter.has(issue.severity) &&
        statusFilter.has(issue.status) &&
        categoryFilter.has(issue.category),
    );
    const searched = searchIssues(filtered, searchQuery, runwayById);
    return sortIssues(searched, sortKey);
  }, [allIssues, severityFilter, statusFilter, categoryFilter, searchQuery, sortKey, runwayById]);

  const selectedIssue = selectedIssueId
    ? allIssues.find((issue) => issue.id === selectedIssueId)
    : undefined;
  const selectedTicket = selectedIssue ? ticketForIssue(selectedIssue, tickets) : undefined;

  const toggleSeverity = (severity: Severity) => {
    setSeverityFilter((current) => {
      const next = new Set(current);
      if (next.has(severity)) {
        if (next.size > 1) next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  };

  const toggleStatus = (status: IssueStatus) => {
    setReviewQueueOnly(false);
    setStatusFilter((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        if (next.size > 1) next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const toggleCategory = (category: IssueCategory) => {
    setCategoryFilter((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        if (next.size > 1) next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const toggleReviewQueue = () => {
    setReviewQueueOnly((active) => {
      if (active) {
        setStatusFilter(new Set(ALL_STATUSES));
        return false;
      }
      setStatusFilter(new Set(REVIEW_QUEUE_STATUSES));
      return true;
    });
  };

  const focusRunway = (runwayId: string) => {
    setFocusedRunwayId(runwayId);
    const map = mapRef.current;
    if (!map) return;
    if (runwayId === "all") {
      const bounds = boundsRef.current;
      if (bounds && !bounds.isEmpty()) map.fitBounds(bounds, { padding: OVERVIEW_PADDING, maxZoom: OVERVIEW_MAX_ZOOM, duration: 450 });
      return;
    }
    const runway = runwayById[runwayId];
    const anchor = runway ? runwayAnchor(runway) : undefined;
    if (anchor) map.easeTo({ center: pos(anchor), zoom: 15, duration: 450 });
  };

  const mappable = layers.filter((l) => isMappable(l.runway));
  const mapSig = [
    airportCenter ? `${airportCenter.lat},${airportCenter.lng}` : "",
    ...mappable.map((l) => {
      const anchor = runwayAnchor(l.runway);
      return anchor ? `${l.runway.id}:${anchor.lat},${anchor.lng}` : l.runway.id;
    }),
  ].join("|");
  const runways = layers.map((l) => l.runway);

  const loadKeepOutZones = useCallback(() => {
    if (!airportId) return;
    api.listKeepOutZones({ airportId }).then(setKeepOutZones).catch(() => setKeepOutZones([]));
  }, [airportId]);

  const resetKeepOutDraft = () => {
    setDraftName("");
    setDraftReason("");
    setDraftRunwayId("");
    setPlotPoints([]);
    setKeepOutErr(null);
    setKeepOutStep("list");
  };

  const closeKeepOut = () => {
    setKeepOutOpen(false);
    resetKeepOutDraft();
    const map = mapRef.current;
    if (map && loadedRef.current) clearKeepOutDraftLayer(map);
  };

  const startKeepOutCreate = () => {
    setKeepOutErr(null);
    setDraftName("");
    setDraftReason("");
    setDraftRunwayId(focusedRunwayId !== "all" ? focusedRunwayId : runways[0]?.id ?? "");
    setPlotPoints([]);
    setKeepOutStep("details");
  };

  const saveKeepOutZone = async () => {
    const runway = runwayById[draftRunwayId];
    if (!runway || plotPoints.length < 3 || !draftName.trim()) {
      setKeepOutErr("Complete the form and plot at least 3 corners.");
      return;
    }
    const stations = stationsFromPolygon(runway, plotPoints);
    setKeepOutBusy(true);
    setKeepOutErr(null);
    try {
      await api.createKeepOutZone({
        airportId,
        runwayId: draftRunwayId,
        name: draftName.trim(),
        reason: draftReason.trim() || undefined,
        polygon: plotPoints,
        stationStartM: stations?.stationStartM,
        stationEndM: stations?.stationEndM,
      });
      loadKeepOutZones();
      resetKeepOutDraft();
      setKeepOutOpen(true);
    } catch (e) {
      setKeepOutErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setKeepOutBusy(false);
    }
  };

  const keepOutAction = async (fn: () => Promise<unknown>) => {
    setKeepOutBusy(true);
    setKeepOutErr(null);
    try {
      await fn();
      loadKeepOutZones();
    } catch (e) {
      setKeepOutErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setKeepOutBusy(false);
    }
  };

  const loadInspectionZones = useCallback(() => {
    const ids = runways.map((r) => r.id);
    if (ids.length === 0) {
      setInspectionZones([]);
      return;
    }
    Promise.all(ids.map((id) => api.listZones(id).catch(() => [] as Zone[])))
      .then((lists) => {
        setInspectionZones(lists.flat());
        setZonesReady(true);
      })
      .catch(() => {
        setInspectionZones([]);
        setZonesReady(true);
      });
  }, [runways]);

  const resetZoneDraw = () => {
    setZoneDraftName("");
    setZoneDraftRunwayId("");
    setZonePlotPoints([]);
    setZoneDrawErr(null);
    setZoneDrawStep("details");
  };

  const closeZoneDraw = () => {
    setZoneDrawOpen(false);
    setZoneDrawLockRunwayId(undefined);
    resetZoneDraw();
    const map = mapRef.current;
    if (map && loadedRef.current) clearInspectionZoneDraftLayer(map);
  };

  const cancelZoneHoverClear = () => {
    if (zoneHoverClearTimer.current) {
      clearTimeout(zoneHoverClearTimer.current);
      zoneHoverClearTimer.current = null;
    }
  };

  const scheduleZoneHoverClear = () => {
    cancelZoneHoverClear();
    zoneHoverClearTimer.current = setTimeout(() => {
      if (!zoneHoverPinned.current) setZoneHover(null);
    }, 150);
  };

  const startZoneDraw = (runwayId?: string) => {
    const rid = runwayId ?? (focusedRunwayId !== "all" ? focusedRunwayId : runways[0]?.id ?? "");
    if (inspectionZones.some((z) => z.runwayId === rid)) {
      setZoneDrawErr("This runway already has a zone. Delete it before drawing a new one.");
      setZoneDraftRunwayId(rid);
      setZoneDrawOpen(true);
      setZoneDrawStep("details");
      return;
    }
    setZoneDrawErr(null);
    setZoneDraftName("");
    setZoneDraftRunwayId(rid);
    setZonePlotPoints([]);
    setZoneDrawStep("details");
    setZoneDrawOpen(true);
  };

  const saveInspectionZone = async () => {
    const runway = runwayById[zoneDraftRunwayId];
    if (!runway || zonePlotPoints.length < 3 || !zoneDraftName.trim()) {
      setZoneDrawErr("Complete the form and plot at least 3 corners.");
      return;
    }
    const stations = stationsFromPolygon(runway, zonePlotPoints);
    setZoneDrawBusy(true);
    setZoneDrawErr(null);
    try {
      await api.createZone({
        runwayId: zoneDraftRunwayId,
        name: zoneDraftName.trim(),
        polygon: zonePlotPoints,
        stationStartM: stations?.stationStartM,
        stationEndM: stations?.stationEndM,
      });
      loadInspectionZones();
      closeZoneDraw();
    } catch (e) {
      setZoneDrawErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setZoneDrawBusy(false);
    }
  };

  const deleteInspectionZone = async (zoneId: string) => {
    setZoneDrawBusy(true);
    setZoneDrawErr(null);
    try {
      await api.deleteZone(zoneId);
      setZoneHover(null);
      loadInspectionZones();
    } catch (e) {
      setZoneDrawErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setZoneDrawBusy(false);
    }
  };

  useEffect(() => {
    if (zonePlotMode) setIssueListOpen(false);
  }, [zonePlotMode]);

  useEffect(() => {
    loadInspectionZones();
  }, [loadInspectionZones]);

  useEffect(() => {
    if (!autoDrawZone || autoDrawStarted.current || !canEditZones || !zonesReady) return;
    autoDrawStarted.current = true;
    const rid = autoDrawZone.runwayId;
    if (rid && inspectionZones.some((z) => z.runwayId === rid)) return;
    if (autoDrawZone.runwayId) setZoneDrawLockRunwayId(autoDrawZone.runwayId);
    startZoneDraw(autoDrawZone.runwayId);
    if (autoDrawZone.runwayId) focusRunway(autoDrawZone.runwayId);
    setZoneDrawStep("plot");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDrawZone, canEditZones, zonesReady, inspectionZones]);

  useEffect(() => () => cancelZoneHoverClear(), []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    ensureInspectionZoneLayers(map);
    updateInspectionZoneLayers(map, inspectionZones);
  }, [inspectionZones, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    updateInspectionZoneDraftLayer(map, zonePlotPoints);
  }, [zonePlotPoints, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    map.getCanvas().style.cursor = zonePlotMode || plotMode ? "crosshair" : "";
  }, [zonePlotMode, plotMode, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !zonePlotMode) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      setZonePlotPoints((prev) => [...prev, { lat: e.lngLat.lat, lng: e.lngLat.lng }]);
    };

    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [zonePlotMode, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || zonePlotMode) return;

    const onEnter = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const zone = id ? inspectionZones.find((z) => z.id === id) : undefined;
      if (zone) {
        cancelZoneHoverClear();
        const anchor = zonePopupPoint(map, zone);
        setZoneHover({ zone, x: anchor.x, y: anchor.y });
        map.getCanvas().style.cursor = "pointer";
      }
    };
    const onLeave = () => {
      scheduleZoneHoverClear();
      map.getCanvas().style.cursor = "";
    };

    map.on("mouseenter", INSPECTION_ZONE_FILL_LAYER, onEnter);
    map.on("mouseleave", INSPECTION_ZONE_FILL_LAYER, onLeave);
    return () => {
      map.off("mouseenter", INSPECTION_ZONE_FILL_LAYER, onEnter);
      map.off("mouseleave", INSPECTION_ZONE_FILL_LAYER, onLeave);
    };
  }, [inspectionZones, zonePlotMode, mapLoaded]);

  useEffect(() => {
    loadKeepOutZones();
  }, [loadKeepOutZones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    ensureKeepOutLayers(map);
    updateKeepOutZoneLayers(map, keepOutZones);
  }, [keepOutZones, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    updateKeepOutDraftLayer(map, plotPoints);
  }, [plotPoints, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !plotMode || zonePlotMode) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      setPlotPoints((prev) => [...prev, { lat: e.lngLat.lat, lng: e.lngLat.lng }]);
    };

    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [plotMode, zonePlotMode, mapLoaded]);

  useEffect(() => {
    if (!containerRef.current || (mappable.length === 0 && !airportCenter)) return;

    const initialCenter = airportCenter ?? runwayAnchor(mappable[0]?.runway);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle,
        center: initialCenter ? pos(initialCenter) : undefined,
        zoom: OVERVIEW_MAX_ZOOM,
        attributionControl: { compact: true },
        dragRotate: false,
        cooperativeGestures: false,
        minZoom: 0,
      });
    } catch {
      setFailed(true);
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const bounds = buildBounds(layers, airportCenter);
      const airportBounds = paddedBounds(bounds);
      const airportMinZoom = minZoomForBounds(map, airportBounds);

      map.setMinZoom(airportMinZoom);
      if (!airportBounds.isEmpty()) map.setMaxBounds(airportBounds);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: OVERVIEW_PADDING, maxZoom: OVERVIEW_MAX_ZOOM, duration: 0 });
      else if (airportCenter) map.easeTo({ center: pos(airportCenter), zoom: OVERVIEW_MAX_ZOOM, duration: 0 });

      mapRef.current = map;
      boundsRef.current = bounds;
      loadedRef.current = true;
      setMapLoaded(true);
      ensureKeepOutLayers(map);
      updateKeepOutZoneLayers(map, keepOutZones);
      ensureInspectionZoneLayers(map);
      updateInspectionZoneLayers(map, inspectionZones);
    });

    map.on("error", () => {/* tile/network errors are non-fatal */});

    return () => {
      loadedRef.current = false;
      setMapLoaded(false);
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSig]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    const bounds = buildBounds(layers, airportCenter);
    boundsRef.current = bounds;
    const airportBounds = paddedBounds(bounds);
    map.setMinZoom(minZoomForBounds(map, airportBounds));
    map.setMaxBounds(airportBounds.isEmpty() ? undefined : airportBounds);
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: OVERVIEW_PADDING, maxZoom: OVERVIEW_MAX_ZOOM, duration: 450 });
    } else if (airportCenter) {
      map.easeTo({ center: pos(airportCenter), zoom: OVERVIEW_MAX_ZOOM, duration: 450 });
    }
  }, [layers, mapLoaded, airportCenter]);

  useEffect(() => {
    if (selectedIssueId && !filteredIssues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(null);
    }
  }, [filteredIssues, selectedIssueId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "Escape") {
        if (zoneDrawOpen) {
          closeZoneDraw();
          return;
        }
        if (keepOutOpen) {
          closeKeepOut();
          return;
        }
        setSelectedIssueId(null);
        return;
      }

      if (!issueListOpen || filteredIssues.length === 0) return;

      const idx = selectedIssueId ? filteredIssues.findIndex((i) => i.id === selectedIssueId) : -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = filteredIssues[Math.min(idx + 1, filteredIssues.length - 1)];
        if (next) setSelectedIssueId(next.id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = filteredIssues[Math.max(idx <= 0 ? 0 : idx - 1, 0)];
        if (next) setSelectedIssueId(next.id);
      } else if (e.key === "Enter" && selectedIssueId) {
        router.push(`/issue/${selectedIssueId}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredIssues, issueListOpen, keepOutOpen, zoneDrawOpen, router, selectedIssueId]);

  const activeKeepOutCount = keepOutZones.filter((z) => z.active).length;
  const focusedHasZone =
    focusedRunwayId !== "all" && inspectionZones.some((z) => z.runwayId === focusedRunwayId);

  if (mappable.length === 0 && !airportCenter) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#dbdfe3] bg-[#f3f5f7] text-center`}>
        <p className="px-6 text-[12px] text-[#6b7176]">
          No runway anchors configured yet — pick an airport in Admin or add threshold coordinates.
        </p>
      </div>
    );
  }
  if (failed) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#dbdfe3] bg-[#f3f5f7] text-center`}>
        <p className="px-6 text-[12px] text-[#6b7176]">Map unavailable (WebGL not supported in this browser).</p>
      </div>
    );
  }

  return (
    <div className={`relative ${heightClass} w-full`}>
      <div ref={containerRef} className="h-full w-full overflow-hidden rounded-md border border-[#dbdfe3]" />
      <KeepOutMapTrigger activeCount={activeKeepOutCount} onClick={() => setKeepOutOpen(true)} />
      <KeepOutZonesModal
        open={keepOutOpen}
        step={keepOutStep}
        zones={keepOutZones}
        runways={runways}
        focusedRunwayId={focusedRunwayId}
        canEdit={canEditKeepOut}
        busy={keepOutBusy}
        err={keepOutErr}
        name={draftName}
        reason={draftReason}
        runwayId={draftRunwayId}
        plotPoints={plotPoints}
        onClose={closeKeepOut}
        onStep={setKeepOutStep}
        onName={setDraftName}
        onReason={setDraftReason}
        onRunwayId={setDraftRunwayId}
        onStartCreate={startKeepOutCreate}
        onUndoPlot={() => setPlotPoints((prev) => prev.slice(0, -1))}
        onFinishPlot={() => setKeepOutStep("confirm")}
        onSave={() => void saveKeepOutZone()}
        onToggleActive={(id, active) => void keepOutAction(() => api.updateKeepOutZone(id, { active }))}
        onDelete={(id) => void keepOutAction(() => api.deleteKeepOutZone(id))}
      />
      {plotMode && (
        <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-md border border-[#b23b32]/40 bg-[#fbfcfd]/95 px-3 py-2 shadow-md backdrop-blur-sm">
          <p className="font-mono text-[11px] text-[#181b1e]">Click the map to add corners · Esc cancels</p>
        </div>
      )}
      {zonePlotMode && (
        <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-md border border-[#2f5b85]/40 bg-[#fbfcfd]/95 px-3 py-2 shadow-md backdrop-blur-sm">
          <p className="font-mono text-[11px] text-[#181b1e]">Click to draw zone corners · Use Undo in the panel · Esc cancels</p>
        </div>
      )}
      {canEditZones && !zoneDrawOpen && !focusedHasZone && (
        <button
          type="button"
          onClick={() => startZoneDraw(focusedRunwayId !== "all" ? focusedRunwayId : undefined)}
          className="absolute left-3 top-[4.5rem] z-10 inline-flex items-center gap-1.5 rounded-md border border-[#c7cdd2] bg-[#fbfcfd]/95 px-3 py-2 text-[12px] font-medium text-[#181b1e] shadow-md backdrop-blur-sm transition-colors hover:bg-[#eef1f4]"
        >
          <Layers size={14} strokeWidth={2} className="text-[#2f5b85]" />
          Draw zone
        </button>
      )}
      <InspectionZonesModal
        open={zoneDrawOpen}
        step={zoneDrawStep}
        runways={runways.filter(
          (r) => zoneDrawLockRunwayId === r.id || !inspectionZones.some((z) => z.runwayId === r.id),
        )}
        lockRunwayId={zoneDrawLockRunwayId}
        busy={zoneDrawBusy}
        err={zoneDrawErr}
        name={zoneDraftName}
        runwayId={zoneDraftRunwayId}
        plotPoints={zonePlotPoints}
        onClose={closeZoneDraw}
        onStep={setZoneDrawStep}
        onName={setZoneDraftName}
        onRunwayId={setZoneDraftRunwayId}
        onUndoPlot={() => setZonePlotPoints((prev) => prev.slice(0, -1))}
        onFinishPlot={() => setZoneDrawStep("confirm")}
        onSave={() => void saveInspectionZone()}
      />
      {zoneHover && canEditZones && (
        <div
          className="pointer-events-auto absolute z-30 min-w-[10rem] rounded-md border border-[#dbdfe3] bg-[#fbfcfd] p-2.5 shadow-lg"
          style={{
            left: zoneHover.x,
            top: zoneHover.y,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
          onMouseEnter={() => {
            zoneHoverPinned.current = true;
            cancelZoneHoverClear();
          }}
          onMouseLeave={() => {
            zoneHoverPinned.current = false;
            scheduleZoneHoverClear();
          }}
        >
          <p className="text-[12px] font-semibold text-[#181b1e]">{zoneHover.zone.name}</p>
          <p className={cn("mt-0.5 text-[11px]", "text-[#6b7176]")}>
            {runwayById[zoneHover.zone.runwayId]?.name ?? zoneHover.zone.runwayId}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => router.push(`/admin/runway/${zoneHover.zone.runwayId}`)}
              className={cn("h-7 flex-1 px-2 text-[11px]", BTN)}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={zoneDrawBusy}
              onClick={() => void deleteInspectionZone(zoneHover.zone.id)}
              className={cn("h-7 flex-1 px-2 text-[11px]", BTN_DANGER)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      <MapToolbar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        onRecenter={() => focusRunway(focusedRunwayId)}
        issueListOpen={issueListOpen}
        onToggleIssueList={() => setIssueListOpen((v) => !v)}
        issueCount={filteredIssues.length}
        totalIssueCount={allIssues.length}
        reviewQueueOnly={reviewQueueOnly}
        onToggleReviewQueue={toggleReviewQueue}
        runways={layers.map((l) => l.runway)}
        runwayOverviews={runwayOverviews}
        focusedRunwayId={focusedRunwayId}
        onFocusRunway={focusRunway}
        inspectionScope={inspectionScope}
        onInspectionScopeChange={onInspectionScopeChange}
        inspections={inspections}
        currentInspectionId={currentInspectionId}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
      <div
        className={cn(
          "pointer-events-none absolute left-3 right-3 top-16 z-10 flex min-h-0 flex-col gap-2 md:left-auto md:right-3 md:w-[21rem] md:max-w-[calc(100vw-1.5rem)]",
          legendCollapsed ? "bottom-14" : "bottom-[12.5rem]",
        )}
      >
        <IssueListPanel
          open={issueListOpen}
          issues={filteredIssues}
          runways={runwayById}
          tickets={tickets}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortKey={sortKey}
          onSortChange={setSortKey}
          onToggle={() => setIssueListOpen((v) => !v)}
          onSelect={(issue) => setSelectedIssueId(issue.id)}
          selectedIssueId={selectedIssueId}
        />
        {selectedIssue && (
          <IssueDetailPanel
            issue={selectedIssue}
            runway={runwayById[selectedIssue.runwayId]}
            ticket={selectedTicket}
            onClose={() => setSelectedIssueId(null)}
            onOpen={() => router.push(`/issue/${selectedIssue.id}`)}
            onIssueUpdated={onIssueUpdated}
          />
        )}
      </div>
      <MapLegend
        collapsed={legendCollapsed}
        onToggleCollapsed={() => setLegendCollapsed((v) => !v)}
        severityFilter={severityFilter}
        statusFilter={statusFilter}
        categoryFilter={categoryFilter}
        onToggleSeverity={toggleSeverity}
        onToggleStatus={toggleStatus}
        onToggleCategory={toggleCategory}
      />
    </div>
  );
}
