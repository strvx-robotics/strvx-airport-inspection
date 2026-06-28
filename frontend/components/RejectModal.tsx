"use client";

import { useState } from "react";
import { REJECTION_REASON } from "@/lib/ui";
import { REJECTION_REASONS } from "@/lib/types";
import type { RejectionReason } from "@/lib/types";

// Reject requires a RejectionReason (design §13.1) — the learning signal. The
// confirm button stays disabled until a reason is chosen; the note is optional.
export default function RejectModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (reason: RejectionReason, note?: string) => void;
}) {
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Reject candidate</h2>
          <p className="text-sm text-zinc-500">
            A reason is required — it trains the detector.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Reason
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectionReason)}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select a reason…
            </option>
            {REJECTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {REJECTION_REASON[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Add context for the model…"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            disabled={!reason || busy}
            onClick={() => {
              if (!reason) return;
              setBusy(true);
              onConfirm(reason, note.trim() || undefined);
            }}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Confirm reject
          </button>
        </div>
      </div>
    </div>
  );
}
