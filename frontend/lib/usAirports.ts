import { isAmericanRegion, regionFromLocation } from "./usAirportRegions";

export interface UsAirportRef {
  id: string;
  name: string;
  code: string;
  location: string;
  timezone: string;
  lat: number;
  lng: number;
}

const MAINTENANCE_NAME = /^\[(Delete|Duplicate)\]\s*/i;

export function isUsableUsAirport(airport: UsAirportRef): boolean {
  if (MAINTENANCE_NAME.test(airport.name)) return false;
  const region = regionFromLocation(airport.location);
  return region !== null && isAmericanRegion(region);
}

function sanitizeUsAirports(airports: UsAirportRef[]): UsAirportRef[] {
  return airports.filter(isUsableUsAirport);
}

let cache: UsAirportRef[] | null = null;
let loadPromise: Promise<UsAirportRef[]> | null = null;

export function loadUsAirports(): Promise<UsAirportRef[]> {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) {
    loadPromise = fetch("/data/us-airports.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load airport directory");
        return res.json() as Promise<UsAirportRef[]>;
      })
      .then((data) => {
        cache = sanitizeUsAirports(data);
        return cache;
      });
  }
  return loadPromise;
}

export function searchUsAirports(airports: UsAirportRef[], query: string, limit = 80): UsAirportRef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { airport: UsAirportRef; score: number }[] = [];
  for (const airport of airports) {
    const name = airport.name.toLowerCase();
    const code = airport.code.toLowerCase();
    const location = airport.location.toLowerCase();
    let score = 0;
    if (code === q) score = 100;
    else if (name.startsWith(q)) score = 90;
    else if (code.startsWith(q)) score = 85;
    else if (name.includes(q)) score = 70;
    else if (code.includes(q)) score = 65;
    else if (location.includes(q)) score = 50;
    else continue;
    scored.push({ airport, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.airport.name.localeCompare(b.airport.name),
  );
  return scored.slice(0, limit).map((s) => s.airport);
}

export function matchUsAirport(airports: UsAirportRef[], code: string, name: string): UsAirportRef | undefined {
  const c = code.trim().toUpperCase();
  const n = name.trim().toLowerCase();
  return (
    airports.find((a) => a.code === c && a.name.toLowerCase() === n) ??
    airports.find((a) => a.code === c) ??
    airports.find((a) => a.name.toLowerCase() === n)
  );
}
