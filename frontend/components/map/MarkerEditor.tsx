"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { INPUT } from "@/lib/vstyle";

/**
 * Floating name/delete card for the selected marker. The parent owns positioning:
 * it writes `left`/`top` straight to this card's DOM node (forwarded ref) on every
 * map move, so the card tracks its marker tightly without re-rendering React.
 */
export const MarkerEditor = forwardRef<
  HTMLDivElement,
  {
    name: string;
    onRename: (name: string) => void;
    onDelete: () => void;
    onClose: () => void;
  }
>(function MarkerEditor({ name, onRename, onDelete, onClose }, ref) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync when a different marker is selected (same component instance reused).
  useEffect(() => {
    setValue(name);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [name]);

  const commit = () => {
    onRename(value.trim());
    onClose();
  };

  return (
    <div
      ref={ref}
      className="pointer-events-auto absolute z-20 w-64 rounded-md border border-[#c7cdd2] bg-[#fbfcfd] p-2 shadow-lg"
      style={{ transform: "translate(-50%, calc(-100% - 16px))" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") onClose();
          }}
          placeholder="Marker name"
          className={cn(INPUT, "h-7 min-w-0 flex-1 px-2")}
        />
        <button
          onClick={commit}
          title="Save name"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[#c7cdd2] bg-[#fbfcfd] text-[#5b6166] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e]"
        >
          <Check size={15} strokeWidth={2.2} />
        </button>
        <button
          onClick={onDelete}
          title="Delete marker"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[#c7cdd2] bg-[#fbfcfd] text-[#5b6166] transition-colors hover:border-[#9aa1a6] hover:bg-[#eef1f4] hover:text-[#181b1e]"
        >
          <Trash2 size={15} strokeWidth={2.2} />
        </button>
        <div className="mx-0.5 h-5 w-px shrink-0 bg-[#dbdfe3]" />
        <button
          onClick={onClose}
          title="Close"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#9aa1a6] transition-colors hover:bg-[#eef1f4] hover:text-[#181b1e]"
        >
          <X size={15} strokeWidth={2.2} />
        </button>
      </div>
      {/* little stem pointing down at the marker */}
      <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-[#c7cdd2] bg-[#fbfcfd]" />
    </div>
  );
});
