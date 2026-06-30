import type { LngLat, RunwayMapStatus } from "./types";

export const MAP_STATUS_LABEL: Record<RunwayMapStatus, string> = {
  draft: "Draft map",
  active: "Active map",
  retired: "Retired map",
  needs_review: "Needs review",
};

export function mapStatusTone(status: RunwayMapStatus | undefined, mapped: boolean): "green" | "amber" | "gray" {
  if (!mapped) return "gray";
  if (status === "active") return "green";
  if (status === "needs_review") return "amber";
  return "gray";
}

export function parseRunwayPolygon(raw: string): LngLat[] | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length < 3) return undefined;
    return parsed.map((p) => {
      if (
        !p ||
        typeof p !== "object" ||
        typeof (p as LngLat).lat !== "number" ||
        typeof (p as LngLat).lng !== "number"
      ) {
        throw new Error("bad point");
      }
      return { lat: (p as LngLat).lat, lng: (p as LngLat).lng };
    });
  } catch {
    return undefined;
  }
}

export function polygonToText(polygon?: LngLat[]): string {
  if (!polygon?.length) return "";
  return JSON.stringify(polygon, null, 2);
}
