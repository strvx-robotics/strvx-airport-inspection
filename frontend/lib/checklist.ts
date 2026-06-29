// Standard daily self-inspection checklist items (PRD §6).
//
// MUST stay in sync with the backend source of truth:
// backend/app/repo/checklist.py STANDARD_CHECKLIST_ITEMS. Fixed for P0 so every
// airport gets a consistent Part 139-style list; per-airport custom templates
// are P1 (#10). The frontend uses this list to render/merge the printable
// report; live editing reads the merged list straight from the backend.

import type { IssueCategory } from "./types";

export interface ChecklistItemDef {
  key: string;
  label: string;
  category: IssueCategory;
}

export const STANDARD_CHECKLIST_ITEMS: ChecklistItemDef[] = [
  { key: "pavement_surface", label: "Pavement surface — cracks, spalling, joints", category: "pavement" },
  { key: "pavement_edges", label: "Pavement edges, shoulders & blast pads", category: "pavement" },
  { key: "fod", label: "FOD / debris on the surface", category: "fod" },
  { key: "markings", label: "Runway markings legible & unobscured", category: "marking" },
  { key: "lighting", label: "Runway / edge lighting & signage operational", category: "lighting" },
  { key: "drainage", label: "Drainage / standing water", category: "pavement" },
  { key: "safety_areas", label: "Runway safety areas clear", category: "fod" },
  { key: "obstructions", label: "Obstructions / construction / unserviceable areas", category: "fod" },
];
