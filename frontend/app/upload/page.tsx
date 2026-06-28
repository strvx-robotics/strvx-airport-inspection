"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Upload, ImagePlus, ChevronRight, CheckCircle2 } from "lucide-react";
import Badge from "@/components/Badge";
import { useOverview, useStore } from "@/lib/store";
import * as api from "@/lib/api";
import { CATEGORY, confidenceBand, pct } from "@/lib/ui";
import { RUNWAYS } from "@/lib/seed";
import { cn } from "@/lib/cn";
import { CARD, BAR, INPUT, BTN, BTN_PRIMARY, EYEBROW, H2 } from "@/lib/vstyle";
import type { UploadResult } from "@/lib/api";
import type { Zone } from "@/lib/types";

export default function UploadPage() {
  const router = useRouter();
  const { overview } = useOverview();
  const { role, loadOverview } = useStore();
  const runways = overview?.runways.map((r) => r.runway) ?? RUNWAYS;

  const [runwayId, setRunwayId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allowed = role === "inspector" || role === "admin";
  const selectedRunway = runwayId || runways[0]?.id || "";

  // Load the selected runway's zones for the (optional) zone picker.
  useEffect(() => {
    if (!selectedRunway) return;
    let live = true;
    setZoneId("");
    api
      .listZones(selectedRunway)
      .then((z) => {
        if (live) setZones(z);
      })
      .catch(() => {
        if (live) setZones([]);
      });
    return () => {
      live = false;
    };
  }, [selectedRunway]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <p className={EYEBROW}>Manual capture</p>
        <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
          <Upload size={17} strokeWidth={2} /> Upload imagery
        </h1>
        <div className={cn("mt-4 rounded-md px-4 py-3 text-[13px] text-[#9aa1a6]", CARD)}>
          Switch to the Inspector or Admin role to upload inspection imagery.
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!file || !selectedRunway) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadImage({
        file,
        runwayId: selectedRunway,
        zoneId: zoneId || undefined,
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
      {/* header */}
      <div className="mb-4">
        <p className={EYEBROW}>Manual capture</p>
        <h1 className={cn("mt-1 flex items-center gap-2", H2)}>
          <Upload size={17} strokeWidth={2} /> Upload imagery
        </h1>
        <p className="mt-1 text-[13px] text-[#737a7f]">
          Drop a runway photo — the detector runs and produces issue candidates
          for review.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        {/* capture form */}
        <section className={cn("overflow-hidden rounded-md", CARD)}>
          <div className={cn("px-4 py-3", BAR)}>
            <h2 className="text-[13px] font-semibold text-[#e7eaec]">Capture details</h2>
            <p className="mt-1 text-[12px] text-[#737a7f]">Target runway, zone, and source image.</p>
          </div>

          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
                Runway
              </label>
              <select
                value={selectedRunway}
                onChange={(e) => setRunwayId(e.target.value)}
                className={cn("h-9 w-full px-2", INPUT)}
              >
                {runways.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.designation}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
                Zone (optional)
              </label>
              <select
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                className={cn("h-9 w-full px-2 disabled:opacity-40", INPUT)}
                disabled={zones.length === 0}
              >
                <option value="">Whole runway</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-wide text-[#737a7f]">
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
                    ? "border-[#5b6166] bg-[#16191c] text-[#e7eaec]"
                    : "border-[#343a3f] bg-[#0f1214] text-[#737a7f] hover:border-[#5b6166]",
                )}
              >
                {file ? (
                  <span className="px-3">
                    <span className="font-medium text-[#e7eaec]">{file.name}</span>
                    <br />
                    <span className="font-mono text-[11px] text-[#737a7f]">
                      Click to replace · {(file.size / 1024).toFixed(0)} KB
                    </span>
                  </span>
                ) : (
                  <span className="flex flex-col items-center gap-2">
                    <ImagePlus size={22} strokeWidth={1.6} className="text-[#5b6166]" />
                    <span>
                      Drop an image here, or{" "}
                      <span className="text-[#e7eaec] underline underline-offset-2">browse</span>
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
              <p className="rounded-md border border-[#5b6166] bg-[#16191c] px-3 py-2 text-[13px] font-medium text-[#e7eaec]">
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

        {/* detections */}
        <section className={cn("overflow-hidden rounded-md", CARD)}>
          <div className={cn("px-4 py-3", BAR)}>
            <h2 className="text-[13px] font-semibold text-[#e7eaec]">Detections</h2>
            <p className="mt-1 text-[12px] text-[#737a7f]">Issue candidates from your upload.</p>
          </div>

          <div className="p-4">
            {!result ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[#262b2f] p-12 text-center">
                <ImagePlus size={22} strokeWidth={1.6} className="text-[#5b6166]" />
                <p className="text-[13px] text-[#737a7f]">
                  Candidates from your upload will appear here.
                </p>
              </div>
            ) : result.candidates.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-[#262b2f] bg-[#121517] p-10 text-center">
                <CheckCircle2 size={22} strokeWidth={1.8} className="text-[#737a7f]" />
                <p className="text-[13px] font-medium text-[#e7eaec]">
                  No issues detected in this image.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {result.candidates.map((c) => {
                  const band = confidenceBand(c.confidence);
                  return (
                    <Link
                      key={c.id}
                      href={`/issue/${c.id}`}
                      className="flex items-center justify-between rounded-md border border-[#262b2f] bg-[#0f1214] px-3 py-2.5 transition-colors hover:bg-[#16191c]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[#e7eaec]">
                          {CATEGORY[c.category]}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-[#737a7f]">
                          {pct(c.confidence)} confidence
                        </p>
                      </div>
                      <Badge tone={band.tone}>{band.label}</Badge>
                    </Link>
                  );
                })}
                <button
                  onClick={() => router.push(`/runway/${selectedRunway}`)}
                  className={cn("h-8 w-full px-3 text-[12px]", BTN)}
                >
                  View runway candidates
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
