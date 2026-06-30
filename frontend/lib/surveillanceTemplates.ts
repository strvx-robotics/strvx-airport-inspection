import type { ScheduleFrequency } from "./types";

/**
 * Common Part 139 periodic surveillance items (§139.327(c)). These are quick-pick
 * presets for the admin schedule form — an airport can still type its own.
 */
export interface SurveillanceTemplate {
  label: string;
  frequency: ScheduleFrequency;
  time: string; // default local pass time
  detail: string;
}

export const SURVEILLANCE_TEMPLATES: SurveillanceTemplate[] = [
  {
    label: "Fuel farm inspection",
    frequency: "quarterly",
    time: "09:00",
    detail: "Fuel storage, hydrant, and dispensing system check (§139.321).",
  },
  {
    label: "Runway friction / rubber removal survey",
    frequency: "quarterly",
    time: "09:00",
    detail: "Periodic runway friction testing and rubber-buildup assessment.",
  },
  {
    label: "Airfield lighting & NAVAID survey",
    frequency: "monthly",
    time: "20:00",
    detail: "Edge, threshold, and approach lighting plus visual NAVAIDs.",
  },
  {
    label: "Signage & markings survey",
    frequency: "monthly",
    time: "10:00",
    detail: "Mandatory and guidance signs, painted markings legibility.",
  },
  {
    label: "Pavement condition survey",
    frequency: "weekly",
    time: "08:00",
    detail: "Cracking, spalling, joint, and shoulder condition walk.",
  },
  {
    label: "Wildlife hazard assessment",
    frequency: "monthly",
    time: "07:00",
    detail: "Wildlife attractants and movement-area hazard review.",
  },
];
