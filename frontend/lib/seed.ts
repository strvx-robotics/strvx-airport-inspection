// Demo candidate draft text, shared with the persisted database seed
// (lib/seed-db.ts) so the seeded issue text is identical wherever it's read back
// from Postgres. (The former Phase-0 in-memory UI fixtures — AIRPORT, RUNWAYS,
// seedIssues — were removed: the UI renders entirely from the database now.)

export const PAVEMENT_DRAFT =
  "Transverse crack ~1.2 m with minor spalling at midfield (Zone B). Recommend crack-seal and surface inspection before the next operating window.";
export const FOD_DRAFT =
  "Possible metallic debris (~15 cm) near the threshold (Zone A). Recommend FOD sweep and removal prior to commercial traffic.";
