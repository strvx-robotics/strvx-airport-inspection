"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Rocket } from "lucide-react";
import SelectMenu from "@/components/Select";
import * as api from "@/lib/api";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { INSPECTION_TYPE, SPECIAL_TRIGGER } from "@/lib/ui";
import {
  LAUNCHABLE_INSPECTION_TYPES,
  SPECIAL_TRIGGERS,
  type Inspection,
  type InspectionType,
  type SpecialTrigger,
} from "@/lib/types";
import { BTN, BTN_PRIMARY, CARD, EYEBROW, INPUT, MUTED } from "@/lib/vstyle";

const TYPE_HELP: Record<"daily" | "periodic" | "special", string> = {
  daily: "The canonical 6:00 AM movement-area pass. One per day — re-running opens today's record.",
  periodic: "Recurring surveillance (weekly, monthly, or quarterly) such as fuel-farm or friction checks.",
  special: "Event-triggered inspection after severe weather, an incident, or a sudden field change.",
};

const REASON_PLACEHOLDER: Record<"periodic" | "special", string> = {
  periodic: "e.g. Quarterly fuel farm inspection",
  special: "e.g. 50 kt wind gusts and hail reported at 14:20Z",
};

export default function LaunchInspectionModal({
  onClose,
  onLaunched,
}: {
  onClose: () => void;
  onLaunched: (inspection: Inspection) => void;
}) {
  const [type, setType] = useState<InspectionType>("daily");
  const [trigger, setTrigger] = useState<SpecialTrigger>("weather");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  const isSpecial = type === "special";
  const isDaily = type === "daily";

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const inspection = await api.runInspectionNow(
        type,
        reason.trim() || undefined,
        isSpecial ? trigger : undefined,
      );
      onLaunched(inspection);
    } catch (e) {
      setErr(apiErrorMessage(e, "Could not launch inspection."));
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[#181b1e]/55 p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-inspection-title"
    >
      <div
        className={cn("w-full max-w-lg space-y-4 rounded-md p-5 shadow-[0_16px_48px_rgba(11,13,14,0.24)]", CARD)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#181b1e] text-[#eef1f4]">
            <Rocket size={17} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 id="launch-inspection-title" className="text-[18px] font-semibold text-[#181b1e]">
              Launch inspection
            </h2>
            <p className={cn("mt-1 text-[13px] leading-relaxed", MUTED)}>
              Start a Part 139 self-inspection record now. Daily, periodic surveillance, or a special
              event-triggered pass.
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <label className={EYEBROW}>Inspection type</label>
          <SelectMenu
            value={type}
            options={LAUNCHABLE_INSPECTION_TYPES.map((t) => ({
              value: t,
              label: INSPECTION_TYPE[t].label,
            }))}
            onChange={(v) => setType(v as InspectionType)}
            ariaLabel="Inspection type"
          />
          <p className={cn("text-[11px] leading-relaxed", MUTED)}>
            {TYPE_HELP[type as "daily" | "periodic" | "special"] ?? ""}
          </p>
        </div>

        {isSpecial && (
          <div className="space-y-1">
            <label className={EYEBROW}>Trigger</label>
            <SelectMenu
              value={trigger}
              options={SPECIAL_TRIGGERS.map((t) => ({
                value: t,
                label: SPECIAL_TRIGGER[t].label,
                hint: SPECIAL_TRIGGER[t].detail,
              }))}
              onChange={(v) => setTrigger(v as SpecialTrigger)}
              ariaLabel="Special inspection trigger"
            />
            <p className={cn("text-[11px] leading-relaxed", MUTED)}>{SPECIAL_TRIGGER[trigger].detail}</p>
          </div>
        )}

        {!isDaily && (
          <div className="space-y-1">
            <label className={EYEBROW}>
              {isSpecial ? "Condition notes" : "Surveillance description"}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder={REASON_PLACEHOLDER[type as "periodic" | "special"]}
              className={cn("w-full resize-y px-3 py-2 text-[12px]", INPUT)}
            />
            <p className={cn("text-[11px] leading-relaxed", MUTED)}>
              Recorded on the inspection report for the retained compliance record.
            </p>
          </div>
        )}

        {err && <p className="text-[12px] font-medium text-[#b91c1c]">{err}</p>}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className={cn("px-3 py-2 text-[12px]", BTN)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className={cn("px-3 py-2 text-[12px]", BTN_PRIMARY)}
          >
            <Rocket size={13} strokeWidth={2} />
            {busy ? "Launching…" : "Launch inspection"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
