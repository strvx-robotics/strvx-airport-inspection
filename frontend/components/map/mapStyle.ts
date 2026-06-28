import type { StyleSpecification } from "maplibre-gl";

// Esri World Imagery raster basemap (public, no API key). Imagery is shown in its
// natural color; vector overlays (runway, zones, pins) keep full contrast control.
// Swap the tile URL for a licensed/offline source (MBTiles/PMTiles) in prod.
const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const basemapStyle: StyleSpecification = {
  version: 8,
  // Glyphs power WebGL-rendered text labels (e.g. user marker names). Public
  // MapLibre demo font stack — no API key. Labels rendered from these stay
  // pixel-locked to their coordinates exactly like the rest of the map.
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    sat: {
      type: "raster",
      tiles: [ESRI_IMAGERY],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri",
    },
  },
  layers: [
    { id: "void", type: "background", paint: { "background-color": "#0b0d0e" } },
    {
      id: "sat",
      type: "raster",
      source: "sat",
      paint: {
        "raster-fade-duration": 0,
      },
    },
  ],
};
