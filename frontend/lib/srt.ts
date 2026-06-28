// Parse a DJI SRT telemetry sidecar into time-stamped GPS samples.
//
// DJI's SRT format has changed across firmware/models; we match the two common
// GPS encodings:
//   [latitude: 33.367800] [longitude: -81.965400] [rel_alt: 1.3 abs_alt: 50.0]
//   GPS(-81.965400,33.367800,18)        ← note DJI writes (lng, lat, …) here
// Each subtitle block carries a `HH:MM:SS,mmm --> …` time range; we key samples
// by the block's start time (seconds into the video).
//
// NOTE: the original Mavic Mini generally does NOT emit GPS here — callers must
// handle an empty result by falling back to a manual runway selection.

export interface GpsSample {
  /** Seconds from the start of the video. */
  t: number;
  lat: number;
  lng: number;
  altM?: number;
}

function timeToSeconds(hms: string): number {
  // "HH:MM:SS,mmm" or "HH:MM:SS.mmm"
  const m = /(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(hms);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

function parseLatLng(block: string): { lat: number; lng: number; altM?: number } | undefined {
  // Bracketed form: [latitude: ..] [longitude: ..]
  const latB = /\[?\s*latitude\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(block);
  const lngB = /\[?\s*longitude\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(block);
  if (latB && lngB) {
    const altM = /abs_alt\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(block);
    return { lat: Number(latB[1]), lng: Number(lngB[1]), altM: altM ? Number(altM[1]) : undefined };
  }
  // Parenthesised form: GPS(lng, lat, alt) — DJI writes longitude first here.
  const gps = /GPS\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?))?\s*\)/i.exec(block);
  if (gps) {
    return { lng: Number(gps[1]), lat: Number(gps[2]), altM: gps[3] ? Number(gps[3]) : undefined };
  }
  return undefined;
}

/** Parse SRT text → GPS samples sorted by time. Returns [] when no GPS is present. */
export function parseSrtGps(text: string): GpsSample[] {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  const out: GpsSample[] = [];
  for (const block of blocks) {
    const timeLine = /(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->/.exec(block);
    if (!timeLine) continue;
    const t = timeToSeconds(timeLine[1]);
    const ll = parseLatLng(block);
    if (!ll || Number.isNaN(t)) continue;
    // Drop obviously-null fixes (0,0) some firmwares emit before GPS lock.
    if (ll.lat === 0 && ll.lng === 0) continue;
    out.push({ t, lat: ll.lat, lng: ll.lng, altM: ll.altM });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Nearest GPS sample to `seconds`, or undefined if there are none. */
export function gpsAt(samples: GpsSample[], seconds: number): GpsSample | undefined {
  if (samples.length === 0) return undefined;
  let best = samples[0];
  let bestGap = Math.abs(samples[0].t - seconds);
  for (const s of samples) {
    const gap = Math.abs(s.t - seconds);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}
