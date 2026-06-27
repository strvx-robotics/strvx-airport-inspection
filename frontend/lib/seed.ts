import type { Issue, Runway } from "./types";

// Static demo fixtures. Airport/runways/inspection don't change at runtime,
// so they're plain constants; issues are returned fresh so "reset" works.

export const AIRPORT = { name: "Augusta Regional", code: "AGS" };
export const INSPECTION = { label: "Monday · 6:00 AM", date: "Mon, Jun 22 2026" };

export const RUNWAYS: Runway[] = [
  { id: "r1", name: "Runway 1", designation: "17 – 35", length: "8,001 ft" },
  { id: "r2", name: "Runway 2", designation: "08 – 26", length: "6,000 ft" },
  { id: "r3", name: "Runway 3", designation: "11 – 29", length: "5,001 ft" },
];

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
      draft:
        "Transverse crack ~1.2 m with minor spalling at midfield (Zone B). Recommend crack-seal and surface inspection before the next operating window.",
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
      draft:
        "Possible metallic debris (~15 cm) near the threshold (Zone A). Recommend FOD sweep and removal prior to commercial traffic.",
      inspectorNotes: "",
    },
  ];
}
