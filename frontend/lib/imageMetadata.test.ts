import { describe, expect, it } from "vitest";
import { normalizeExifMetadata } from "./imageMetadata";

describe("normalizeExifMetadata", () => {
  it("maps EXIF GPS and camera fields into the upload metadata contract", () => {
    const meta = normalizeExifMetadata({
      latitude: 33.370123,
      longitude: -81.965456,
      GPSAltitude: 18.5,
      GPSImgDirection: 172.4,
      DateTimeOriginal: new Date("2026-06-30T10:42:00.000Z"),
      Make: "DJI",
      Model: "Mavic 3 Enterprise",
    });

    expect(meta).toEqual({
      gps: { lat: 33.370123, lng: -81.965456 },
      altM: 18.5,
      headingDeg: 172.4,
      capturedAt: "2026-06-30T10:42:00.000Z",
      metadata: {
        cameraMake: "DJI",
        cameraModel: "Mavic 3 Enterprise",
        sourceKind: "image_exif",
      },
      geomConfidence: "gps",
    });
  });

  it("returns empty metadata when no GPS tags are present", () => {
    const meta = normalizeExifMetadata({ Make: "DJI", Model: "Mini 4 Pro" });

    expect(meta.gps).toBeUndefined();
    expect(meta.geomConfidence).toBeUndefined();
    expect(meta.metadata).toEqual({
      cameraMake: "DJI",
      cameraModel: "Mini 4 Pro",
      sourceKind: "image_exif",
    });
  });
});
