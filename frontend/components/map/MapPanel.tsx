"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/** Collapsible overlay panel pinned to the map — a solid instrument panel
 *  (no glass) so labels stay legible over satellite imagery. */
export function MapPanel({
  title,
  icon: Icon,
  collapsed,
  onToggle,
  className,
  fill = false,
  testId,
  children,
}: {
  title: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  // In a flex rail the panel shares a bounded column: the body flexes and
  // scrolls instead of using a fixed max-height (which would overrun siblings).
  fill?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "overflow-hidden rounded-md border border-[#c7cdd2] bg-[#fbfcfd] shadow-lg",
        fill && "flex min-h-0 flex-col",
        className,
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#eef1f4]"
        aria-expanded={!collapsed}
      >
        <Icon size={13} strokeWidth={2} className="text-[#181b1e]" />
        <span className="label flex-1 text-[9px] text-[#3f4448]">{title}</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={cn("text-[#6b7176] transition-transform", collapsed && "-rotate-90")}
        />
      </button>
      {!collapsed && (
        <div
          className={cn(
            "overflow-y-auto border-t border-[#dbdfe3]",
            fill ? "flex min-h-0 flex-1 flex-col" : "max-h-[60vh]",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
