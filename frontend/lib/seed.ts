// Phase-0 in-memory fixtures for the demo UI / store.
//
// CLIENT-SAFE: this module is imported by client components (e.g. the upload
// page and the store), so it must stay free of server-only imports. The
// persisted database seed lives in lib/seed-db.ts (server-only) and mirrors
// these fixtures exactly.

import type { Issue, Runway } from "./types";

export const AIRPORT = { name: "Augusta Regional", code: "AGS" };
export const INSPECTION = { label: "Monday · 6:00 AM", date: "Mon, Jun 22 2026" };

export const RUNWAYS: Runway[] = [
  { id: "r1", airportId: "ags", name: "Runway 1", designation: "17 – 35", length: "8,001 ft" },
  { id: "r2", airportId: "ags", name: "Runway 2", designation: "08 – 26", length: "6,000 ft" },
  { id: "r3", airportId: "ags", name: "Runway 3", designation: "11 – 29", length: "5,001 ft" },
];

// Shared with the persisted seed (lib/seed-db.ts) so the demo candidate text is
// identical whether rendered from fixtures or read back from the database.
export const PAVEMENT_DRAFT =
  "Transverse crack ~1.2 m with minor spalling at midfield (Zone B). Recommend crack-seal and surface inspection before the next operating window.";
export const FOD_DRAFT =
  "Possible metallic debris (~15 cm) near the threshold (Zone A). Recommend FOD sweep and removal prior to commercial traffic.";

export function seedIssues(): Issue[] {
  return [
    {
      id: "i1",
      runwayId: "r2",
      zone: "Zone B · midfield",
      category: "pavement",
      confidence: 0.92,
      severity: "high",
      decision: "pending",
      bbox: { x: 33, y: 52, w: 24, h: 16 },
      gps: { lat: 33.3699, lng: -81.9645 },
      draft: PAVEMENT_DRAFT,
      inspectorNotes: "",
    },
    {
      id: "i2",
      runwayId: "r2",
      zone: "Zone A · threshold",
      category: "fod",
      confidence: 0.68,
      severity: "medium",
      decision: "pending",
      bbox: { x: 58, y: 38, w: 13, h: 13 },
      gps: { lat: 33.3681, lng: -81.9628 },
      draft: FOD_DRAFT,
      inspectorNotes: "",
    },
  ];
}
