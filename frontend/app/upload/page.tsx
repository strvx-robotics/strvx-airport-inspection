"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Badge from "@/components/Badge";
import { useOverview, useStore } from "@/lib/store";
import * as api from "@/lib/api";
import { CATEGORY, confidenceBand, pct } from "@/lib/ui";
import { RUNWAYS } from "@/lib/seed";
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
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Upload image</h1>
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-500">
          Switch to the Inspector or Admin role to upload inspection imagery.
        </p>
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
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Manual capture
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Upload image</h1>
        <p className="text-sm text-zinc-500">
          Drop a runway photo — the detector runs and produces issue candidates
          for review.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Runway
            </label>
            <select
              value={selectedRunway}
              onChange={(e) => setRunwayId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
            >
              {runways.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.designation}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Zone (optional)
            </label>
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:bg-zinc-100 disabled:text-zinc-400"
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

          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
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
              className={`grid h-40 cursor-pointer place-items-center rounded-lg border-2 border-dashed text-center text-sm transition-colors ${
                dragOver
                  ? "border-blue-400 bg-blue-50 text-blue-700"
                  : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400"
              }`}
            >
              {file ? (
                <span className="px-3">
                  <span className="font-medium text-zinc-800">{file.name}</span>
                  <br />
                  <span className="text-xs text-zinc-400">
                    Click to replace · {(file.size / 1024).toFixed(0)} KB
                  </span>
                </span>
              ) : (
                <span>
                  Drop an image here, or <span className="text-blue-600">browse</span>
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
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            disabled={!file || busy}
            onClick={handleSubmit}
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {busy ? "Running detector…" : "Upload & detect"}
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Detections
          </p>
          {!result ? (
            <p className="rounded-md border border-dashed border-zinc-200 px-3 py-8 text-center text-sm text-zinc-400">
              Candidates from your upload will appear here.
            </p>
          ) : result.candidates.length === 0 ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-6 text-center text-sm text-emerald-700">
              No issues detected in this image.
            </p>
          ) : (
            <div className="space-y-2">
              {result.candidates.map((c) => {
                const band = confidenceBand(c.confidence);
                return (
                  <Link
                    key={c.id}
                    href={`/issue/${c.id}`}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 hover:border-zinc-300 hover:shadow-sm"
                  >
                    <div>
                      <p className="text-sm font-medium">{CATEGORY[c.category]}</p>
                      <p className="text-xs text-zinc-500">
                        {pct(c.confidence)} confidence
                      </p>
                    </div>
                    <Badge tone={band.tone}>{band.label}</Badge>
                  </Link>
                );
              })}
              <button
                onClick={() => router.push(`/runway/${selectedRunway}`)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                View runway candidates ›
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
