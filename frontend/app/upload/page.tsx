"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Upload, ImagePlus, ChevronRight, CheckCircle2 } from "lucide-react";
import Badge from "@/components/Badge";
import ZoneImage from "@/components/ZoneImage";
import Select from "@/components/Select";
import { useOverview, useStore } from "@/lib/store";
import * as api from "@/lib/api";
import { CATEGORY, confidenceBand, pct } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { CARD, BAR, BTN, BTN_PRIMARY, EYEBROW, H2 } from "@/lib/vstyle";
import type { UploadResult } from "@/lib/api";
import type { Boundary, Zone } from "@/lib/types";

export default function UploadPage() {
  const router = useRouter();
  const { overview } = useOverview();
  const { role, loadOverview } = useStore();
  const zones = overview?.zones.map((r) => r.zone) ?? [];

  const [zoneId, setZoneId] = useState("");
  const [boundaryId, setBoundaryId] = useState("");
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allowed = role === "inspector" || role === "admin";
  const selectedZoneId = zoneId || zones[0]?.id || "";

  // Load boundaries for the selected zone (optional boundary picker).
  useEffect(() => {
    if (!selectedZoneId) return;
    let live = true;
    setBoundaryId("");
    api
      .listBoundaries(selectedZoneId)
      .then((b) => {
        if (live) setBoundaries(b);
      })
      .catch(() => {
        if (live) setBoundaries([]);
      });
    return () => {
      live = false;
    };
  }, [selectedZoneId]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <p className={EYEBROW}>Manual capture</p>
        <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
          <Upload size={17} strokeWidth={2} /> Upload imagery
        </h1>
        <div className={cn("mt-4 rounded-md px-4 py-3 text-[13px] text-[#5b6166]", CARD)}>
          Switch to the Inspector or Admin role to upload inspection imagery.
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!file || !selectedZoneId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadImage({
        file,
        zoneId: selectedZoneId,
        boundaryId: boundaryId || undefined,
      });
      setResult(res);
      void loadOverview();
    } catch {
      setError("Upload failed. Check that the API is running and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4">
        <p className={EYEBROW}>Manual capture</p>
        <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
          <Upload size={17} strokeWidth={2} /> Upload imagery
        </h1>
        <p className="mt-1 text-[13px] text-[#6b7176]">
          Drop a zone photo — the detector runs and produces issue candidates
          for review.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <section className={cn("overflow-hidden rounded-md", CARD)}>
          <div className={cn("px-4 py-3", BAR)}>
            <h2 className="text-[13px] font-semibold text-[#181b1e]">Capture details</h2>
            <p className="mt-1 text-[12px] text-[#6b7176]">Target zone, boundary, and source image.</p>
          </div>

          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
                Zone
              </label>
              <Select
                value={selectedZoneId}
                options={zones.map((r) => ({ value: r.id, label: `${r.name} · ${r.designation}` }))}
                onChange={setZoneId}
                ariaLabel="Zone"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
                Boundary (optional)
              </label>
              <Select
                value={boundaryId}
                options={[
                  { value: "", label: "Whole zone" },
                  ...boundaries.map((b) => ({ value: b.id, label: b.name })),
                ]}
                onChange={setBoundaryId}
                ariaLabel="Boundary"
                disabled={boundaries.length === 0}
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wide text-[#6b7176]">
                Image
              </label>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setFile(f);
                }}
                className={cn(
                  "grid h-40 cursor-pointer place-items-center rounded-md border border-dashed text-center text-[13px] transition-colors",
                  dragOver
                    ? "border-[#9aa1a6] bg-[#eef1f4] text-[#181b1e]"
                    : "border-[#c7cdd2] bg-[#f3f5f7] text-[#6b7176] hover:border-[#9aa1a6]",
                )}
              >
                {file ? (
                  <span className="px-3">
                    <span className="font-medium text-[#181b1e]">{file.name}</span>
                    <br />
                    <span className="font-mono text-[11px] text-[#6b7176]">
                      Click to replace · {(file.size / 1024).toFixed(0)} KB
                    </span>
                  </span>
                ) : (
                  <span className="flex flex-col items-center gap-2">
                    <ImagePlus size={22} strokeWidth={1.6} className="text-[#9aa1a6]" />
                    <span>
                      Drop an image here, or{" "}
                      <span className="text-[#181b1e] underline underline-offset-2">browse</span>
                    </span>
                  </span>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {error && (
              <p className="rounded-md border border-[#9aa1a6] bg-[#eef1f4] px-3 py-2 text-[13px] font-medium text-[#181b1e]">
                {error}
              </p>
            )}

            <button
              disabled={!file || busy}
              onClick={handleSubmit}
              className={cn("h-9 w-full text-[13px]", BTN_PRIMARY)}
            >
              <Upload size={14} strokeWidth={2} />
              {busy ? "Running detector…" : "Upload & detect"}
            </button>
          </div>
        </section>

        <section className={cn("overflow-hidden rounded-md", CARD)}>
          <div className={cn("px-4 py-3", BAR)}>
            <h2 className="text-[13px] font-semibold text-[#181b1e]">Detections</h2>
            <p className="mt-1 text-[12px] text-[#6b7176]">Issue candidates from your upload.</p>
          </div>

          <div className="p-4">
            {!result ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[#dbdfe3] p-12 text-center">
                <ImagePlus size={22} strokeWidth={1.6} className="text-[#9aa1a6]" />
                <p className="text-[13px] text-[#6b7176]">
                  Candidates from your upload will appear here.
                </p>
              </div>
            ) : result.candidates.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-[#dbdfe3] bg-[#fbfcfd] p-10 text-center">
                <CheckCircle2 size={22} strokeWidth={1.8} className="text-[#6b7176]" />
                <p className="text-[13px] font-medium text-[#181b1e]">
                  No issues detected in this image.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {result.image.fileUrl && (
                  <ZoneImage
                    src={result.image.fileUrl}
                    bbox={result.candidates[0]?.bbox}
                    label={result.candidates[0] ? CATEGORY[result.candidates[0].category] : undefined}
                    heightClass="h-44"
                  />
                )}
                {result.candidates.map((c) => {
                  const band = confidenceBand(c.confidence);
                  return (
                    <Link
                      key={c.id}
                      href={`/issue/${c.id}`}
                      className="flex items-center justify-between rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-3 py-2.5 transition-colors hover:bg-[#eef1f4]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[#181b1e]">
                          {CATEGORY[c.category]}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-[#6b7176]">
                          {pct(c.confidence)} confidence
                        </p>
                      </div>
                      <Badge tone={band.tone}>{band.label}</Badge>
                    </Link>
                  );
                })}
                <button
                  onClick={() => router.push(`/zone/${selectedZoneId}`)}
                  className={cn("h-8 w-full px-3 text-[12px]", BTN)}
                >
                  View zone candidates
                  <ChevronRight size={14} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
