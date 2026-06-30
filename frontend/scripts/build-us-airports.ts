/**
 * Build public/data/us-airports.json from OurAirports CSV.
 * Run: npx tsx scripts/build-us-airports.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isAmericanRegion } from "../lib/usAirportRegions";

export interface UsAirportRecord {
  id: string;
  name: string;
  code: string;
  location: string;
  timezone: string;
  lat: number;
  lng: number;
}

const CSV_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OUT = path.join(process.cwd(), "public/data/us-airports.json");

const INCLUDED_TYPES = new Set([
  "large_airport",
  "medium_airport",
  "small_airport",
  "seaplane_base",
]);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function timezoneFor(lat: number, lng: number, state: string): string {
  if (state === "AK") return "America/Anchorage";
  if (state === "HI") return "Pacific/Honolulu";
  if (state === "AZ") return "America/Phoenix";
  if (state === "PR") return "America/Puerto_Rico";
  if (state === "VI") return "America/Virgin";
  if (state === "GU" || state === "MP") return "Pacific/Guam";
  if (state === "AS") return "Pacific/Pago_Pago";
  if (lng >= -67.5) return "America/New_York";
  if (lng >= -87.5) {
    if (state === "IN" || state === "KY" || state === "TN") return lng >= -86 ? "America/New_York" : "America/Chicago";
    return "America/New_York";
  }
  if (lng >= -102) return "America/Chicago";
  if (lng >= -115) return "America/Denver";
  return "America/Los_Angeles";
}

function airportCode(cols: Record<string, string>): string | null {
  const iata = cols.iata_code?.trim();
  if (iata) return iata.toUpperCase();
  const local = cols.local_code?.trim();
  if (local) return local.toUpperCase();
  const ident = cols.ident?.trim();
  if (ident && ident.length <= 4) return ident.toUpperCase();
  return null;
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch airports CSV: ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const records: UsAirportRecord[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const cols = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    if (cols.iso_country !== "US") continue;
    if (!INCLUDED_TYPES.has(cols.type)) continue;
    if (cols.type === "closed") continue;

    const code = airportCode(cols);
    const name = cols.name?.trim();
    if (!code || !name) continue;
    if (/^\[(Delete|Duplicate)\]\s*/i.test(name)) continue;

    const state = cols.iso_region?.replace(/^US-/, "") ?? "";
    if (!isAmericanRegion(state)) continue;
    const city = cols.municipality?.trim();
    const location = city && state ? `${city}, ${state}` : state || city || "United States";
    const lat = Number(cols.latitude_deg);
    const lng = Number(cols.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const id = cols.ident?.trim() || code;
    const key = `${code}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    records.push({
      id,
      name,
      code,
      location,
      timezone: timezoneFor(lat, lng, state),
      lat,
      lng,
    });
  }

  records.sort((a, b) => a.name.localeCompare(b.name));

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(records));
  console.log(`✓ wrote ${records.length} US airports → ${OUT}`);
}

void main();
