"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/** Collapsible glass overlay panel pinned to the map — mirrors the robotics MapPanel,
 *  restyled monochrome with the airport tokens. */
export function MapPanel({
  title,
  icon: Icon,
  collapsed,
  onToggle,
  className,
  children,
}: {
  title: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-white/10 bg-[#0f1214]/85 shadow-xl backdrop-blur",
        className,
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
        aria-expanded={!collapsed}
      >
        <Icon size={13} strokeWidth={2} className="text-[#e7eaec]" />
        <span className="label flex-1 text-[9px] text-[#c2c8cc]">{title}</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={cn("text-[#737a7f] transition-transform", collapsed && "-rotate-90")}
        />
      </button>
      {!collapsed && <div className="max-h-[60vh] overflow-y-auto border-t border-white/10">{children}</div>}
    </div>
  );
}
