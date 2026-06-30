"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { CARD, BTN, BTN_DANGER, MUTED } from "@/lib/vstyle";
import { cn } from "@/lib/cn";

export default function ConfirmDeleteModal({
  title,
  description,
  itemLabel,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  itemLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const confirmingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onCancel]);

  const handleConfirm = () => {
    if (confirmingRef.current || busy) return;
    confirmingRef.current = true;
    setBusy(true);
    void Promise.resolve(onConfirm()).finally(() => {
      setBusy(false);
      confirmingRef.current = false;
    });
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[#181b1e]/55 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
    >
      <div
        className={cn("w-full max-w-md space-y-4 rounded-md p-5 shadow-[0_16px_48px_rgba(11,13,14,0.24)]", CARD)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#b23b32]/10 text-[#b23b32]">
            <Trash2 size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-delete-title" className="text-[18px] font-semibold text-[#181b1e]">
              {title}
            </h2>
            <p className={cn("mt-1 text-[13px] leading-relaxed", MUTED)}>{description}</p>
          </div>
        </div>

        {itemLabel && (
          <p className="rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-3 py-2 font-mono text-[12px] text-[#181b1e]">
            {itemLabel}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={onCancel} disabled={busy} className={cn("px-3 py-2 text-[12px]", BTN)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleConfirm}
            className={cn("px-3 py-2 text-[12px]", BTN_DANGER)}
          >
            {busy ? "Removing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
