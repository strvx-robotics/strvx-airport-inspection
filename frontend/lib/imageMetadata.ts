import exifr from "exifr";
import type { GeomConfidence, LngLat } from "./types";

export interface UploadImageMetadata {
  gps?: LngLat;
  stationM?: number;
  lateralOffsetM?: number;
  altM?: number;
  headingDeg?: number;
  capturedAt?: string;
  geomConfidence?: GeomConfidence;
  metadata?: Record<string, unknown>;
}

type ExifLike = Record<string, unknown>;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function isoDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return undefined;
}

export function normalizeExifMetadata(tags: ExifLike | null | undefined): UploadImageMetadata {
  const lat = num(tags?.latitude);
  const lng = num(tags?.longitude);
  const cameraMake = text(tags?.Make);
  const cameraModel = text(tags?.Model);
  const metadata: Record<string, unknown> = { sourceKind: "image_exif" };
  if (cameraMake) metadata.cameraMake = cameraMake;
  if (cameraModel) metadata.cameraModel = cameraModel;

  const gps = lat != null && lng != null ? { lat, lng } : undefined;
  return {
    gps,
    altM: num(tags?.GPSAltitude),
    headingDeg: num(tags?.GPSImgDirection),
    capturedAt: isoDate(tags?.DateTimeOriginal) ?? isoDate(tags?.CreateDate),
    geomConfidence: gps ? "gps" : undefined,
    metadata,
  };
}

export async function extractImageMetadata(buffer: Buffer): Promise<UploadImageMetadata> {
  const tags = await exifr.parse(buffer, {
    gps: true,
    tiff: true,
    exif: true,
  });
  return normalizeExifMetadata(tags);
}
