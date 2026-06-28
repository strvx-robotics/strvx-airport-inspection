"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Radio, Cog, Wrench, Map as MapIcon, User, ChevronDown, Check, type LucideIcon } from "lucide-react";
import { useStore } from "@/lib/store";
import { ROLE } from "@/lib/ui";
import { USER_ROLES } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Persistent navigable top bar — mirrors the Valanor console Header. */
export default function Header() {
  const { role, setRole } = useStore();
  const pathname = usePathname();
  const showLive = role === "inspector" || role === "admin";
  const showAdmin = role === "admin";
  const isMaintenance = role === "maintenance";

  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center border-b border-black/10 bg-panel/95 px-4 backdrop-blur">
      {/* brand */}
      <Link href="/" className="flex items-center gap-2.5">
        {/* wordmark art is white; invert it to read on the light header */}
        <img src="/valanor-wordmark.png" alt="Valanor" className="h-[30px] w-auto invert" />
        <span className="label hidden text-[9px] text-ink-faint sm:inline">
          Airport Inspection
        </span>
      </Link>

      {/* view nav — centered. Maintenance's home is the work-order tracker. */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-black/10 bg-black/20 p-0.5">
        {isMaintenance ? (
          <NavTab href="/" active={pathname === "/"} icon={Wrench} label="Work orders" />
        ) : (
          <NavTab href="/" active={pathname === "/"} icon={Gauge} label="Overview" />
        )}
        {showLive && (
          <NavTab href="/live" active={pathname === "/live"} icon={Radio} label="Live" />
        )}
        <NavTab href="/map" active={pathname === "/map"} icon={MapIcon} label="Map" />
        {showAdmin && (
          <NavTab href="/admin" active={pathname === "/admin"} icon={Cog} label="Admin" />
        )}
      </div>

      {/* profile — circular avatar opens a role switcher */}
      <div className="ml-auto">
        <ProfileMenu role={role} setRole={setRole} />
      </div>
    </header>
  );
}

function ProfileMenu({
  role,
  setRole,
}: {
  role: (typeof USER_ROLES)[number];
  setRole: (r: (typeof USER_ROLES)[number]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full p-0.5 text-ink-dim transition-colors hover:text-ink"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black/15 bg-black/30 text-ink-dim">
          <User size={16} strokeWidth={1.8} />
        </span>
        <ChevronDown size={14} strokeWidth={2} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-black/10 bg-panel/95 p-1 shadow-xl backdrop-blur"
          >
            <p className="label px-2.5 py-1.5 text-[8px] text-ink-faint">Switch role</p>
            {USER_ROLES.map((r) => (
              <button
                key={r}
                role="menuitemradio"
                aria-checked={role === r}
                onClick={() => {
                  setRole(r);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 transition-colors",
                  role === r ? "bg-accent/15 text-accent" : "text-ink-dim hover:bg-black/5 hover:text-ink",
                )}
              >
                <span className="label text-[9px] text-current">{ROLE[r]}</span>
                {role === r && <Check size={13} strokeWidth={2.2} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NavTab({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
        active ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink",
      )}
    >
      <Icon size={14} strokeWidth={1.8} />
      <span className="label text-[9px] text-current">{label}</span>
    </Link>
  );
}
