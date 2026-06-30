"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { EYEBROW, INPUT } from "@/lib/vstyle";
import {
  loadUsAirports,
  searchUsAirports,
  type UsAirportRef,
} from "@/lib/usAirports";

export default function AirportSearchSelect({
  value,
  onChange,
  disabled,
}: {
  value?: UsAirportRef | null;
  onChange: (airport: UsAirportRef) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [airports, setAirports] = useState<UsAirportRef[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => {
    void loadUsAirports()
      .then(setAirports)
      .catch(() => setLoadErr("Could not load airport directory."));
  }, []);

  const results = useMemo(
    () => (airports ? searchUsAirports(airports, query) : []),
    [airports, query],
  );

  const openMenu = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    setActive(0);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = (airport: UsAirportRef) => {
    onChange(airport);
    setQuery("");
    setOpen(false);
  };

  const display = value ? `${value.name} (${value.code})` : "";

  return (
    <div className="space-y-1">
      <label className={EYEBROW}>Airport name</label>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          disabled={disabled || !!loadErr}
          onClick={() => (open ? setOpen(false) : openMenu())}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-[#fbfcfd] px-3 text-left text-[12px] transition-colors",
            open ? "border-[#181b1e] ring-2 ring-[#181b1e]/10" : "border-[#c7cdd2] hover:border-[#888f95]",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className={cn("truncate", !display && "text-[#9aa1a6]")}>
            {display || "Search US airports…"}
          </span>
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-[#6b7176] transition-transform", open && "rotate-180")}
          />
        </button>
        {loadErr && <p className="mt-1 text-[11px] text-[#b23b32]">{loadErr}</p>}

        {open &&
          rect &&
          createPortal(
            <div
              ref={panelRef}
              style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}
              className="z-[60] overflow-hidden rounded-md border border-[#c7cdd2] bg-[#fbfcfd] shadow-lg"
            >
              <div className="relative border-b border-[#e4e8eb] px-2 py-2">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa1a6]"
                />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setOpen(false);
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((i) => Math.min(results.length - 1, i + 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((i) => Math.max(0, i - 1));
                    } else if (e.key === "Enter" && results[active]) {
                      e.preventDefault();
                      choose(results[active]);
                    }
                  }}
                  placeholder="Type name, code, or city…"
                  className={cn(INPUT, "h-8 w-full pl-8 pr-2 text-[12px]")}
                />
              </div>
              <ul
                ref={menuRef}
                role="listbox"
                className="max-h-64 overflow-y-auto p-1"
              >
                {!airports ? (
                  <li className="px-2.5 py-2 text-[12px] text-[#9aa1a6]">Loading airports…</li>
                ) : results.length === 0 ? (
                  <li className="px-2.5 py-2 text-[12px] text-[#9aa1a6]">
                    {query.trim()
                      ? "No matching US airports."
                      : "Type a name, city, or airport code to search US airports."}
                  </li>
                ) : (
                  results.map((airport, i) => (
                    <li
                      key={airport.id}
                      id={`${baseId}-opt-${i}`}
                      role="option"
                      aria-selected={value?.id === airport.id}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(airport)}
                      className={cn(
                        "cursor-pointer rounded-md px-2.5 py-2 text-[12px]",
                        i === active ? "bg-[#eef1f4]" : "hover:bg-[#eef1f4]",
                      )}
                    >
                      <span className="block font-medium text-[#181b1e]">{airport.name}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-[#6b7176]">
                        {airport.code} · {airport.location} · {airport.timezone}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
