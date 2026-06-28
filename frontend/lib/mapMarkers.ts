// User-dropped map markers: a lightweight annotation layer on the airport map.
//
// A marker is just a named geographic point. They persist in localStorage keyed
// by airport so they survive reloads, and render as native MapLibre GeoJSON
// layers (circle + symbol) so they stay pixel-locked to their coordinates when
// panning/zooming. Purely client-side for now — see AirportMap for the UI.

export interface MapMarker {
  id: string;
  /** Exact geographic point under the cursor when dropped. */
  lng: number;
  lat: number;
  name: string;
}

const KEY = (airportId: string): string => `strvx.markers.${airportId}`;

export function newMarkerId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function loadMarkers(airportId: string): MapMarker[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY(airportId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: keep only well-formed records (storage can be hand-edited/stale).
    return parsed.filter(
      (m): m is MapMarker =>
        !!m &&
        typeof m === "object" &&
        typeof (m as MapMarker).id === "string" &&
        Number.isFinite((m as MapMarker).lng) &&
        Number.isFinite((m as MapMarker).lat) &&
        typeof (m as MapMarker).name === "string",
    );
  } catch {
    return [];
  }
}

export function saveMarkers(airportId: string, markers: MapMarker[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(airportId), JSON.stringify(markers));
  } catch {
    /* quota / disabled storage — non-fatal, markers just won't persist */
  }
}
