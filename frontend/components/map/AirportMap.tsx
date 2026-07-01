"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Boundary, IssueCandidate, IssueCategory, IssueStatus, KeepOutZone, LngLat, Severity, Ticket, Zone } from "@/lib/types";
import { isMappable, issuePosition, zoneAnchor } from "@/lib/zoneGeom";
import { stationsFromPolygon } from "@/lib/keepOutGeom";
import * as api from "@/lib/api";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { basemapStyle } from "./mapStyle";
import { IssueDetailPanel, MapLegend, MapToolbar } from "./MapToolbar";
import { KeepOutZonesModal, type KeepOutStep } from "./KeepOutZonesModal";
import { BoundariesModal, type BoundaryDrawStep } from "./BoundariesModal";
import { IssuePreviewCard } from "./IssuePreviewCard";
import {
  clearBoundaryDraftLayer,
  ensureBoundaryLayers,
  BOUNDARY_FILL_LAYER,
  updateBoundaryDraftLayer,
  updateBoundaryLayers,
} from "./boundaryMapLayers";
import {
  clearKeepOutDraftLayer,
  ensureKeepOutLayers,
  updateKeepOutDraftLayer,
  updateKeepOutZoneLayers,
} from "./keepOutMapLayers";
import { ensureIssueLayers, ISSUE_CIRCLE_LAYER, issueMarkers, updateIssueLayers } from "./issueMapLayers";
import { searchIssues, sortIssues, ticketForIssue, type IssueSortKey } from "./mapUtils";
import { BTN, BTN_DANGER } from "@/lib/vstyle";

export interface ZoneLayer {
  zone: Zone;
  issues: IssueCandidate[];
}

const pos = (p: LngLat): [number, number] => [p.lng, p.lat];
const ALL_SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const ALL_STATUSES: IssueStatus[] = ["pending", "manual_review", "approved", "rejected"];
const ALL_CATEGORIES: IssueCategory[] = ["fod", "pavement", "marking", "lighting"];
const REVIEW_QUEUE_STATUSES: IssueStatus[] = ["pending", "manual_review"];

// Start automatic overview fits at an airfield scale without limiting manual zoom.
const OVERVIEW_MAX_ZOOM = 12;
const OVERVIEW_PADDING = 80;
const OVERVIEW_ZOOM_OUT_BUFFER = 3.5;
const MAP_BOUNDS_TIGHT_PADDING_DEG = 0.04;

function buildBounds(layers: ZoneLayer[], airportCenter?: LngLat) {
  const bounds = new maplibregl.LngLatBounds();
  if (airportCenter) bounds.extend(pos(airportCenter));
  for (const { zone } of layers) {
    if (!isMappable(zone)) continue;
    const anchor = zoneAnchor(zone);
    if (anchor) bounds.extend(pos(anchor));
  }
  return bounds;
}

function paddedBounds(bounds: maplibregl.LngLatBounds) {
  if (bounds.isEmpty()) return bounds;
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return new maplibregl.LngLatBounds(
    [sw.lng - MAP_BOUNDS_TIGHT_PADDING_DEG, sw.lat - MAP_BOUNDS_TIGHT_PADDING_DEG],
    [ne.lng + MAP_BOUNDS_TIGHT_PADDING_DEG, ne.lat + MAP_BOUNDS_TIGHT_PADDING_DEG],
  );
}

function boundaryPopupPoint(map: maplibregl.Map, boundary: Boundary): { x: number; y: number } {
  const poly = boundary.polygon;
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
  return Math.max(0, fitZoom - OVERVIEW_ZOOM_OUT_BUFFER);
}

/** Satellite map: severity-colored issue markers, no-drone zones, and inspection zones. */
export default function AirportMap({
  layers,
  tickets,
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
  layers: ZoneLayer[];
  tickets: Ticket[];
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
  autoDrawZone?: { zoneId?: string };
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
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<IssueSortKey>("severity");
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(() => new Set(ALL_SEVERITIES));
  const [statusFilter, setStatusFilter] = useState<Set<IssueStatus>>(() => new Set(ALL_STATUSES));
  const [categoryFilter, setCategoryFilter] = useState<Set<IssueCategory>>(() => new Set(ALL_CATEGORIES));
  const [reviewQueueOnly, setReviewQueueOnly] = useState(false);
  const [focusedZoneId, setFocusedZoneId] = useState<string>("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedIssuePoint, setSelectedIssuePoint] = useState<{ x: number; y: number } | null>(null);

  const [keepOutOpen, setKeepOutOpen] = useState(false);
  const [keepOutStep, setKeepOutStep] = useState<KeepOutStep>("list");
  const [keepOutZones, setKeepOutZones] = useState<KeepOutZone[]>([]);
  const [keepOutBusy, setKeepOutBusy] = useState(false);
  const [keepOutErr, setKeepOutErr] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [draftZoneId, setDraftZoneId] = useState("");
  const [plotPoints, setPlotPoints] = useState<LngLat[]>([]);

  const [zoneDrawOpen, setZoneDrawOpen] = useState(false);
  const [zoneDrawStep, setBoundaryDrawStep] = useState<BoundaryDrawStep>("details");
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [zonesReady, setZonesReady] = useState(false);
  const [zoneDrawBusy, setZoneDrawBusy] = useState(false);
  const [zoneDrawErr, setZoneDrawErr] = useState<string | null>(null);
  const [zoneDraftName, setZoneDraftName] = useState("");
  const [zoneDraftZoneId, setZoneDraftZoneId] = useState("");
  const [zonePlotPoints, setZonePlotPoints] = useState<LngLat[]>([]);
  const [boundaryPopup, setBoundaryPopup] = useState<{ boundary: Boundary; x: number; y: number } | null>(null);
  const [zoneDeleteConfirm, setZoneDeleteConfirm] = useState(false);
  const [zoneDrawLockZoneId, setZoneDrawLockZoneId] = useState<string | undefined>();
  const autoDrawStarted = useRef(false);
  const zoneSaveInFlight = useRef(false);

  const plotMode = keepOutOpen && keepOutStep === "plot";
  const zonePlotMode = zoneDrawOpen && zoneDrawStep === "plot";

  const allIssues = layers.flatMap(({ issues }) => issues);
  const zoneById = Object.fromEntries(layers.map((layer) => [layer.zone.id, layer.zone] as const));

  const filteredIssues = useMemo(() => {
    const filtered = allIssues.filter(
      (issue) =>
        severityFilter.has(issue.severity) &&
        statusFilter.has(issue.status) &&
        categoryFilter.has(issue.category),
    );
    const searched = searchIssues(filtered, searchQuery, zoneById);
    return sortIssues(searched, sortKey);
  }, [allIssues, severityFilter, statusFilter, categoryFilter, searchQuery, sortKey, zoneById]);

  const selectedIssue = selectedIssueId
    ? allIssues.find((issue) => issue.id === selectedIssueId)
    : undefined;
  const selectedTicket = selectedIssue ? ticketForIssue(selectedIssue, tickets) : undefined;
  const selectedIssueZone = selectedIssue ? zoneById[selectedIssue.zoneId] : undefined;
  const selectedIssueMapPosition = selectedIssue && selectedIssueZone
    ? issuePosition(selectedIssueZone, selectedIssue)
    : undefined;

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

  const focusZone = (zoneId: string) => {
    setFocusedZoneId(zoneId);
    const map = mapRef.current;
    if (!map) return;
    if (zoneId === "all") {
      const bounds = boundsRef.current;
      if (bounds && !bounds.isEmpty()) map.fitBounds(bounds, { padding: OVERVIEW_PADDING, maxZoom: OVERVIEW_MAX_ZOOM, duration: 450 });
      return;
    }
    const zone = zoneById[zoneId];
    const anchor = zone ? zoneAnchor(zone) : undefined;
    if (anchor) map.easeTo({ center: pos(anchor), zoom: 15, duration: 450 });
  };

  const mappable = layers.filter((l) => isMappable(l.zone));
  const mapSig = [
    airportCenter ? `${airportCenter.lat},${airportCenter.lng}` : "",
    ...mappable.map((l) => {
      const anchor = zoneAnchor(l.zone);
      return anchor ? `${l.zone.id}:${anchor.lat},${anchor.lng}` : l.zone.id;
    }),
  ].join("|");
  const zones = layers.map((l) => l.zone);

  const loadKeepOutZones = useCallback(() => {
    if (!airportId) return;
    api.listKeepOutZones({ airportId }).then(setKeepOutZones).catch(() => setKeepOutZones([]));
  }, [airportId]);

  const resetKeepOutDraft = () => {
    setDraftName("");
    setDraftReason("");
    setDraftZoneId("");
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
    setDraftZoneId(focusedZoneId !== "all" ? focusedZoneId : zones[0]?.id ?? "");
    setPlotPoints([]);
    setKeepOutStep("details");
  };

  const saveKeepOutZone = async () => {
    const zone = zoneById[draftZoneId];
    if (!zone || plotPoints.length < 3 || !draftName.trim()) {
      setKeepOutErr("Complete the form and plot at least 3 corners.");
      return;
    }
    const stations = stationsFromPolygon(zone, plotPoints);
    setKeepOutBusy(true);
    setKeepOutErr(null);
    try {
      await api.createKeepOutZone({
        airportId,
        zoneId: draftZoneId,
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

  const loadBoundaries = useCallback(() => {
    const ids = zones.map((r) => r.id);
    if (ids.length === 0) {
      setBoundaries([]);
      return;
    }
    Promise.all(ids.map((id) => api.listBoundaries(id).catch(() => [] as Boundary[])))
      .then((lists) => {
        setBoundaries(lists.flat());
        setZonesReady(true);
      })
      .catch(() => {
        setBoundaries([]);
        setZonesReady(true);
      });
  }, [zones]);

  const resetZoneDraw = () => {
    setZoneDraftName("");
    setZoneDraftZoneId("");
    setZonePlotPoints([]);
    setZoneDrawErr(null);
    setBoundaryDrawStep("details");
  };

  const closeZoneDraw = () => {
    setZoneDrawOpen(false);
    setZoneDrawLockZoneId(undefined);
    resetZoneDraw();
    const map = mapRef.current;
    if (map && loadedRef.current) clearBoundaryDraftLayer(map);
  };

  const closeBoundaryPopup = useCallback(() => {
    setBoundaryPopup(null);
    setZoneDeleteConfirm(false);
  }, []);

  const startZoneDraw = (zoneId?: string) => {
    const rid = zoneId ?? (focusedZoneId !== "all" ? focusedZoneId : zones[0]?.id ?? "");
    if (boundaries.some((b) => b.zoneId === rid)) {
      setZoneDrawErr("This zone already has a boundary. Delete it before drawing a new one.");
      setZoneDraftZoneId(rid);
      setZoneDrawOpen(true);
      setBoundaryDrawStep("details");
      return;
    }
    setZoneDrawErr(null);
    setZoneDraftName("");
    setZoneDraftZoneId(rid);
    setZonePlotPoints([]);
    setBoundaryDrawStep("details");
    setZoneDrawOpen(true);
  };

  const saveInspectionZone = async () => {
    const zone = zoneById[zoneDraftZoneId];
    if (!zone || zonePlotPoints.length < 3 || !zoneDraftName.trim()) {
      setZoneDrawErr("Complete the form and plot at least 3 corners.");
      return;
    }
    // Guard against a double-clicked "Save zone" firing two creates: the disabled
    // state lands a render later, so without this ref both clicks slip through and
    // race the one-zone-per-zone check (the backend serializes too, but this keeps
    // the user from a spurious "already has a boundary" on their own second click).
    if (zoneSaveInFlight.current) return;
    zoneSaveInFlight.current = true;
    const stations = stationsFromPolygon(zone, zonePlotPoints);
    setZoneDrawBusy(true);
    setZoneDrawErr(null);
    try {
      await api.createBoundary({
        zoneId: zoneDraftZoneId,
        name: zoneDraftName.trim(),
        polygon: zonePlotPoints,
        stationStartM: stations?.stationStartM,
        stationEndM: stations?.stationEndM,
      });
      loadBoundaries();
      closeZoneDraw();
    } catch (e) {
      setZoneDrawErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setZoneDrawBusy(false);
      zoneSaveInFlight.current = false;
    }
  };

  const deleteBoundaryOnMap = async (boundaryId: string) => {
    setZoneDrawBusy(true);
    setZoneDrawErr(null);
    try {
      await api.deleteBoundary(boundaryId);
      closeBoundaryPopup();
      loadBoundaries();
    } catch (e) {
      setZoneDrawErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setZoneDrawBusy(false);
    }
  };

  useEffect(() => {
    loadBoundaries();
  }, [loadBoundaries]);

  useEffect(() => {
    if (!autoDrawZone || autoDrawStarted.current || !canEditZones || !zonesReady) return;
    autoDrawStarted.current = true;
    const rid = autoDrawZone.zoneId;
    if (rid && boundaries.some((z) => z.zoneId === rid)) return;
    if (autoDrawZone.zoneId) setZoneDrawLockZoneId(autoDrawZone.zoneId);
    startZoneDraw(autoDrawZone.zoneId);
    if (autoDrawZone.zoneId) focusZone(autoDrawZone.zoneId);
    setBoundaryDrawStep("plot");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDrawZone, canEditZones, zonesReady, boundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    ensureBoundaryLayers(map);
    updateBoundaryLayers(map, boundaries);
  }, [boundaries, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    updateBoundaryDraftLayer(map, zonePlotPoints);
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

  // Click a zone (admin only) to open its actions popup; pointer cursor on hover.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || zonePlotMode || plotMode || !canEditZones) return;

    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const boundary = id ? boundaries.find((b) => b.id === id) : undefined;
      if (!boundary) return;
      const anchor = boundaryPopupPoint(map, boundary);
      setBoundaryPopup({ boundary, x: anchor.x, y: anchor.y });
      setZoneDeleteConfirm(false);
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", BOUNDARY_FILL_LAYER, onClick);
    map.on("mouseenter", BOUNDARY_FILL_LAYER, onEnter);
    map.on("mouseleave", BOUNDARY_FILL_LAYER, onLeave);
    return () => {
      map.off("click", BOUNDARY_FILL_LAYER, onClick);
      map.off("mouseenter", BOUNDARY_FILL_LAYER, onEnter);
      map.off("mouseleave", BOUNDARY_FILL_LAYER, onLeave);
    };
  }, [boundaries, zonePlotMode, plotMode, canEditZones, mapLoaded]);

  // The popup is anchored to a fixed screen position, so dismiss it the moment the
  // camera moves (zoom or pan) instead of letting it drift away from its zone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !boundaryPopup) return;
    const onMoveStart = () => closeBoundaryPopup();
    map.on("movestart", onMoveStart);
    return () => {
      map.off("movestart", onMoveStart);
    };
  }, [boundaryPopup, mapLoaded, closeBoundaryPopup]);

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

  // Plot issue markers (read-only) at each issue's best map position. Respects the
  // active filters via `filteredIssues`; the selected marker reads emphasized.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    ensureIssueLayers(map);
    updateIssueLayers(map, issueMarkers(filteredIssues, zoneById), selectedIssueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredIssues, selectedIssueId, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedIssueMapPosition) {
      setSelectedIssuePoint(null);
      return;
    }

    const updatePoint = () => {
      const point = map.project(pos(selectedIssueMapPosition));
      setSelectedIssuePoint({ x: point.x, y: point.y });
    };

    updatePoint();
    map.easeTo({
      center: pos(selectedIssueMapPosition),
      zoom: Math.max(map.getZoom(), 16),
      duration: 500,
    });
    map.on("move", updatePoint);
    return () => {
      map.off("move", updatePoint);
    };
  }, [mapLoaded, selectedIssueId, selectedIssueMapPosition?.lat, selectedIssueMapPosition?.lng]);

  // Click an issue marker to open its detail panel; pointer cursor on hover.
  // Disabled while plotting a zone so map clicks add corners instead.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || plotMode || zonePlotMode) return;

    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const props = e.features?.[0]?.properties;
      const id = props?.id as string | undefined;
      const issueIds = typeof props?.issueIds === "string" ? JSON.parse(props.issueIds) as string[] : undefined;
      if (issueIds && issueIds.length > 1) {
        setSelectedIssueId((current) => {
          const idx = current ? issueIds.indexOf(current) : -1;
          return issueIds[(idx + 1) % issueIds.length];
        });
      } else if (id) {
        setSelectedIssueId(id);
      }
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", ISSUE_CIRCLE_LAYER, onClick);
    map.on("mouseenter", ISSUE_CIRCLE_LAYER, onEnter);
    map.on("mouseleave", ISSUE_CIRCLE_LAYER, onLeave);
    return () => {
      map.off("click", ISSUE_CIRCLE_LAYER, onClick);
      map.off("mouseenter", ISSUE_CIRCLE_LAYER, onEnter);
      map.off("mouseleave", ISSUE_CIRCLE_LAYER, onLeave);
    };
  }, [mapLoaded, plotMode, zonePlotMode]);

  useEffect(() => {
    if (!containerRef.current || (mappable.length === 0 && !airportCenter)) return;

    const initialCenter = airportCenter ?? zoneAnchor(mappable[0]?.zone);

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
      const airportMinZoom = minZoomForBounds(map, bounds);

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
      ensureBoundaryLayers(map);
      updateBoundaryLayers(map, boundaries);
      ensureIssueLayers(map); // added last → issue markers render on top
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
    map.setMinZoom(minZoomForBounds(map, bounds));
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
        if (boundaryPopup) {
          closeBoundaryPopup();
          return;
        }
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

      if (filteredIssues.length === 0) return;

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
  }, [filteredIssues, keepOutOpen, zoneDrawOpen, boundaryPopup, closeBoundaryPopup, router, selectedIssueId]);

  const activeKeepOutCount = keepOutZones.filter((z) => z.active).length;
  const focusedHasZone =
    focusedZoneId !== "all" && boundaries.some((z) => z.zoneId === focusedZoneId);

  if (mappable.length === 0 && !airportCenter) {
    return (
      <div className={`flex ${heightClass} items-center justify-center rounded-md border border-[#dbdfe3] bg-[#f3f5f7] text-center`}>
        <p className="px-6 text-[12px] text-[#6b7176]">
          No zone anchors configured yet — pick an airport in Admin or add threshold coordinates.
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
      <KeepOutZonesModal
        open={keepOutOpen}
        step={keepOutStep}
        keepOutZones={keepOutZones}
        operationalZones={zones}
        focusedZoneId={focusedZoneId}
        canEdit={canEditKeepOut}
        busy={keepOutBusy}
        err={keepOutErr}
        name={draftName}
        reason={draftReason}
        zoneId={draftZoneId}
        plotPoints={plotPoints}
        onClose={closeKeepOut}
        onStep={setKeepOutStep}
        onName={setDraftName}
        onReason={setDraftReason}
        onZoneId={setDraftZoneId}
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
          <p className="font-mono text-[11px] text-[#181b1e]">Click to draw boundary corners · Use Undo in the panel · Esc cancels</p>
        </div>
      )}
      <BoundariesModal
        open={zoneDrawOpen}
        step={zoneDrawStep}
        zones={zones.filter(
          (r) => zoneDrawLockZoneId === r.id || !boundaries.some((b) => b.zoneId === r.id),
        )}
        lockZoneId={zoneDrawLockZoneId}
        busy={zoneDrawBusy}
        err={zoneDrawErr}
        name={zoneDraftName}
        zoneId={zoneDraftZoneId}
        plotPoints={zonePlotPoints}
        onClose={closeZoneDraw}
        onStep={setBoundaryDrawStep}
        onName={setZoneDraftName}
        onZoneId={setZoneDraftZoneId}
        onUndoPlot={() => setZonePlotPoints((prev) => prev.slice(0, -1))}
        onFinishPlot={() => setBoundaryDrawStep("confirm")}
        onSave={() => void saveInspectionZone()}
      />
      {boundaryPopup && canEditZones && (
        <div
          className="pointer-events-auto absolute z-30 min-w-[11rem] rounded-md border border-[#dbdfe3] bg-[#fbfcfd] p-2.5 shadow-lg"
          style={{
            left: boundaryPopup.x,
            top: boundaryPopup.y,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
        >
          <p className="text-[12px] font-semibold text-[#181b1e]">{boundaryPopup.boundary.name}</p>
          <p className={cn("mt-0.5 text-[11px]", "text-[#6b7176]")}>
            {zoneById[boundaryPopup.boundary.zoneId]?.name ?? boundaryPopup.boundary.zoneId}
          </p>
          {zoneDeleteConfirm ? (
            <div className="mt-2">
              <p className="text-[11px] leading-snug text-[#b23b32]">Delete this boundary? This cannot be undone.</p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  disabled={zoneDrawBusy}
                  onClick={() => setZoneDeleteConfirm(false)}
                  className={cn("h-7 flex-1 px-2 text-[11px]", BTN)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={zoneDrawBusy}
                  onClick={() => void deleteBoundaryOnMap(boundaryPopup.boundary.id)}
                  className={cn("h-7 flex-1 px-2 text-[11px]", BTN_DANGER)}
                >
                  {zoneDrawBusy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => router.push(`/admin/zone/${boundaryPopup.boundary.zoneId}`)}
                className={cn("h-7 flex-1 px-2 text-[11px]", BTN)}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setZoneDeleteConfirm(true)}
                className={cn("h-7 flex-1 px-2 text-[11px]", BTN_DANGER)}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      <MapToolbar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        issueCount={filteredIssues.length}
        totalIssueCount={allIssues.length}
        reviewQueueOnly={reviewQueueOnly}
        onToggleReviewQueue={toggleReviewQueue}
        inspectionScope={inspectionScope}
        onInspectionScopeChange={onInspectionScopeChange}
        inspections={inspections}
        currentInspectionId={currentInspectionId}
        onOpenKeepOut={() => setKeepOutOpen(true)}
        keepOutActiveCount={activeKeepOutCount}
        canDrawZone={canEditZones && !zoneDrawOpen && !focusedHasZone}
        onDrawZone={() => startZoneDraw(focusedZoneId !== "all" ? focusedZoneId : undefined)}
        onRefresh={onRefresh}
        refreshing={refreshing}
        issues={filteredIssues}
        zonesById={zoneById}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortKey={sortKey}
        onSortChange={setSortKey}
        onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
        selectedIssueId={selectedIssueId}
      />
      <MapLegend
        severityFilter={severityFilter}
        statusFilter={statusFilter}
        categoryFilter={categoryFilter}
        onToggleSeverity={toggleSeverity}
        onToggleStatus={toggleStatus}
        onToggleCategory={toggleCategory}
      />
      {selectedIssue && selectedIssuePoint && (
        <IssuePreviewCard
          issue={selectedIssue}
          ticket={selectedTicket}
          zoneName={selectedIssueZone?.name ?? "Zone"}
          point={selectedIssuePoint}
          onClose={() => setSelectedIssueId(null)}
          onOpen={() => router.push(`/issue/${selectedIssue.id}`)}
        />
      )}
      {selectedIssue && (
        <IssueDetailPanel
          issue={selectedIssue}
          zone={zoneById[selectedIssue.zoneId]}
          ticket={selectedTicket}
          onClose={() => setSelectedIssueId(null)}
          onOpen={() => router.push(`/issue/${selectedIssue.id}`)}
          onIssueUpdated={onIssueUpdated}
        />
      )}
    </div>
  );
}
