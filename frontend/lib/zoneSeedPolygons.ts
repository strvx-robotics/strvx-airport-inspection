/** Approximate map polygons for bootstrap/seed inspection zones. */
export function zoneSeedPolygon(lat: number, lng: number): string {
  const box = [
    { lat: lat - 0.00035, lng: lng - 0.0005 },
    { lat: lat + 0.00035, lng: lng - 0.0005 },
    { lat: lat + 0.00035, lng: lng + 0.0005 },
    { lat: lat - 0.00035, lng: lng + 0.0005 },
  ];
  return JSON.stringify(box);
}

/** One inspection zone per zone — lat/lng anchor at segment center. */
export const SEED_ZONE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  z_r1: { lat: 33.371, lng: -81.967 },
  z_r2: { lat: 33.3685, lng: -81.9635 },
  z_r3: { lat: 33.372, lng: -81.965 },
};
