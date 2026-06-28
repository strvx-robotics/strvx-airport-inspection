// /api/settings — read + update app configuration.
//
// Currently just the drone HLS playback URL for the Live tab. Stored in the
// Supabase `app_settings` table so it persists across devices/deploys (no more
// editing NEXT_PUBLIC_DRONE_STREAM_URL env vars).

import { getSetting, setSetting } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRONE_HLS_URL = "drone_hls_url";

interface Body {
  droneHlsUrl?: string;
}

export const GET = route(async () => {
  const droneHlsUrl = (await getSetting(DRONE_HLS_URL)) ?? null;
  return json({ droneHlsUrl });
});

export const PUT = route(async (req) => {
  const body = await readJson<Body>(req);
  const raw = typeof body.droneHlsUrl === "string" ? body.droneHlsUrl.trim() : "";

  // Allow clearing the URL (empty string), otherwise require a plausible http(s) URL.
  if (raw && !/^https?:\/\/.+/i.test(raw)) {
    throw new Error("droneHlsUrl must be an http(s) URL (the media server's .m3u8 HLS URL)");
  }
  await setSetting(DRONE_HLS_URL, raw);
  return json({ droneHlsUrl: raw || null });
});
