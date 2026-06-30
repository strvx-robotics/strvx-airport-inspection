"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, Loader2, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { BTN, BTN_PRIMARY, CARD, EYEBROW, MUTED } from "@/lib/vstyle";

export type ExportFormat = "html" | "pdf" | "csv" | "json";

type LoadState = "loading" | "ready" | "error";

/**
 * Preview-before-download dialog for inspection exports. The report bytes are
 * fetched once into a blob; the in-browser preview and the Download button both
 * reuse that blob, so previewing never costs a second request. A fresh blob URL
 * also strips the API's `content-disposition: attachment` header, letting PDF/CSV
 * render inline instead of immediately downloading.
 */
export default function ExportPreviewModal({
  url,
  format,
  label,
  icon: Icon,
  filename,
  passLabel,
  onClose,
}: {
  url: string;
  format: ExportFormat;
  label: string;
  icon: LucideIcon;
  filename: string;
  passLabel?: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<LoadState>("loading");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let live = true;
    let created: string | null = null;
    setState("loading");
    setErrMsg(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Report request failed (${res.status}).`);
        const blob = await res.blob();
        if (format === "csv" || format === "json") {
          const body = await blob.text();
          if (live) setText(body);
        }
        created = URL.createObjectURL(blob);
        if (!live) {
          URL.revokeObjectURL(created);
          return;
        }
        setBlobUrl(created);
        setState("ready");
      })
      .catch((e) => {
        if (!live) return;
        setErrMsg(e instanceof Error ? e.message : "Could not load the report.");
        setState("error");
      });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, format]);

  const download = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[#181b1e]/55 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-preview-title"
    >
      <div
        className={cn(
          "flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-md shadow-[0_16px_48px_rgba(11,13,14,0.24)]",
          CARD,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[#dbdfe3] bg-[#eef1f4] px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#181b1e] text-[#eef1f4]">
            <Icon size={17} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="export-preview-title" className="truncate text-[15px] font-semibold text-[#181b1e]">
              {label} preview
            </h2>
            <p className={cn("truncate text-[12px]", MUTED)}>
              {passLabel ? `${passLabel} · ` : ""}
              {filename}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className={cn("h-8 w-8 shrink-0 p-0", BTN)}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f3f5f7]">
          <PreviewBody state={state} format={format} blobUrl={blobUrl} text={text} errMsg={errMsg} label={label} />
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#dbdfe3] bg-[#eef1f4] px-4 py-3">
          <p className={cn("hidden text-[11px] sm:block", MUTED)}>
            Review the export, then download to save a copy.
          </p>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <a
              href={blobUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={state !== "ready"}
              onClick={(e) => {
                if (state !== "ready") e.preventDefault();
              }}
              className={cn(
                "h-8 px-3 text-[12px]",
                BTN,
                state !== "ready" && "pointer-events-none opacity-40",
              )}
            >
              <ExternalLink size={13} strokeWidth={2} />
              Open in new tab
            </a>
            <button
              type="button"
              onClick={download}
              disabled={state !== "ready"}
              className={cn("h-8 px-3 text-[12px]", BTN_PRIMARY)}
            >
              <Download size={13} strokeWidth={2} />
              Download
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function PreviewBody({
  state,
  format,
  blobUrl,
  text,
  errMsg,
  label,
}: {
  state: LoadState;
  format: ExportFormat;
  blobUrl: string | null;
  text: string;
  errMsg: string | null;
  label: string;
}) {
  if (state === "loading") {
    return (
      <div className={cn("grid h-full place-items-center text-[13px]", MUTED)}>
        <span className="flex items-center gap-2">
          <Loader2 size={16} strokeWidth={2} className="animate-spin" />
          Preparing {label.toLowerCase()}…
        </span>
      </div>
    );
  }

  if (state === "error" || !blobUrl) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-[13px] font-medium text-[#b91c1c]">Could not load preview</p>
          <p className={cn("mx-auto mt-1 max-w-sm text-[12px]", MUTED)}>
            {errMsg ?? "The report could not be generated."}
          </p>
        </div>
      </div>
    );
  }

  if (format === "html" || format === "pdf") {
    return (
      <iframe
        title={`${label} preview`}
        src={blobUrl}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  if (format === "json") {
    return <JsonPreview text={text} />;
  }

  return <CsvPreview text={text} />;
}

function JsonPreview({ text }: { text: string }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }, [text]);
  return (
    <pre className="h-full overflow-auto bg-[#fbfcfd] p-4 font-mono text-[11.5px] leading-relaxed text-[#181b1e]">
      {pretty}
    </pre>
  );
}

/** RFC-4180-ish CSV parse that respects quoted fields and embedded newlines. */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function CsvPreview({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text), [text]);
  const cols = useMemo(() => rows.reduce((max, r) => Math.max(max, r.length), 1), [rows]);

  let expectHeader = true;
  return (
    <div className="h-full overflow-auto bg-[#fbfcfd]">
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {rows.map((r, idx) => {
            const nonEmpty = r.filter((c) => c.trim() !== "");
            if (nonEmpty.length === 0) {
              expectHeader = true;
              return (
                <tr key={idx}>
                  <td colSpan={cols} className="h-3" />
                </tr>
              );
            }
            if (r.length === 1) {
              expectHeader = true;
              return (
                <tr key={idx}>
                  <td
                    colSpan={cols}
                    className={cn("border-b border-[#dbdfe3] bg-[#eef1f4] px-3 py-2", EYEBROW)}
                  >
                    {r[0]}
                  </td>
                </tr>
              );
            }
            const isHeader = expectHeader;
            expectHeader = false;
            return (
              <tr key={idx} className={isHeader ? "bg-[#f3f5f7]" : undefined}>
                {Array.from({ length: cols }).map((_, c) => {
                  const value = r[c] ?? "";
                  return isHeader ? (
                    <th
                      key={c}
                      className="border-b border-[#dbdfe3] px-3 py-1.5 text-left font-semibold text-[#3f4448]"
                    >
                      {value}
                    </th>
                  ) : (
                    <td
                      key={c}
                      className="border-b border-[#edf1f3] px-3 py-1.5 align-top text-[#181b1e]"
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
