"use client";

import { useState } from "react";
import { REJECTION_REASON } from "@/lib/ui";
import { REJECTION_REASONS } from "@/lib/types";
import type { RejectionReason } from "@/lib/types";
import { CARD, INPUT, BTN, BTN_DANGER } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

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
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className={cn("w-full max-w-md space-y-4 rounded-md p-5", CARD)}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-[18px] font-semibold text-[#e7eaec]">Reject candidate</h2>
          <p className="mt-1 text-[13px] text-[#737a7f]">
            A reason is required — it trains the detector.
          </p>
        </div>

        <div className="space-y-1">
          <label className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#737a7f]">
            Reason
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectionReason)}
            className={cn("w-full px-2 py-2", INPUT)}
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
          <label className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#737a7f]">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Add context for the model…"
            className={cn("w-full px-3 py-2", INPUT)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={onCancel} className={cn("px-3 py-2 text-[12px]", BTN)}>
            Cancel
          </button>
          <button
            disabled={!reason || busy}
            onClick={() => {
              if (!reason) return;
              setBusy(true);
              onConfirm(reason, note.trim() || undefined);
            }}
            className={cn("px-3 py-2 text-[12px]", BTN_DANGER)}
          >
            Confirm reject
          </button>
        </div>
      </div>
    </div>
  );
}
