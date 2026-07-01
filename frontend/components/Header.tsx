"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Radio, Cog, Wrench, Map as MapIcon, ScrollText, User, ChevronDown, Check, Shield, type LucideIcon } from "lucide-react";
import { useStore } from "@/lib/store";
import { ROLE } from "@/lib/ui";
import { USER_ROLES } from "@/lib/types";
import { cn } from "@/lib/cn";
import { systemState, SYSTEM_DOT, SYSTEM_TEXT, type SystemState } from "@/lib/vstyle";

/** The upper instrument rail — a fixed matte-slate band that, with the status
 *  bar below, brackets the light workspace into one accountable console. */
export default function Header() {
  const { role, setRole, online } = useStore();
  const pathname = usePathname();
  const showLive = role === "inspector" || role === "admin" || role === "security";
  const showAdmin = role === "admin";
  const isMaintenance = role === "maintenance";
  const isSecurity = role === "security";
  const state = systemState(online);

  return (
    <header className="relative z-30 flex h-[72px] shrink-0 items-center gap-4 border-b border-[#0c0e10] bg-[#181b1e] px-6">
      {/* brand */}
      <Link href="/" className="flex items-center gap-3">
        <img src="/valanor-wordmark.png" alt="Valanor" className="h-[34px] w-auto" />
        <span className="hidden h-4 w-px bg-[#2b3035] sm:block" />
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[#888f95] sm:inline">
          Airfield Inspection
        </span>
      </Link>

      {/* view nav — centered. Maintenance's home is the work-order tracker. */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center divide-x divide-[#2b3035] rounded-md bg-[#121517] p-0.5 ring-1 ring-inset ring-[#2b3035]">
        {isMaintenance ? (
          <NavTab href="/" active={pathname === "/"} icon={Wrench} label="Work orders" />
        ) : isSecurity ? (
          <NavTab href="/" active={pathname === "/"} icon={Shield} label="Security" />
        ) : (
          <NavTab href="/" active={pathname === "/"} icon={Gauge} label="Overview" />
        )}
        {showLive && (
          <NavTab href="/live" active={pathname === "/live"} icon={Radio} label="Live" />
        )}
        <NavTab href="/map" active={pathname === "/map"} icon={MapIcon} label="Map" />
        {!isMaintenance && !isSecurity && (
          <NavTab href="/logs" active={pathname === "/logs"} icon={ScrollText} label="Logs" />
        )}
        {showAdmin && (
          <NavTab href="/admin" active={pathname === "/admin"} icon={Cog} label="Admin" />
        )}
      </div>

      {/* right cluster — system lamp + role */}
      <div className="ml-auto flex items-center gap-3">
        <SystemLamp state={state} />
        <span className="hidden h-4 w-px bg-[#2b3035] md:block" />
        <ProfileMenu role={role} setRole={setRole} />
      </div>
    </header>
  );
}

/** Steady (never pulsing) master-status lamp. Green = systems up, red = down,
 *  neutral until the first API reply. */
function SystemLamp({ state }: { state: SystemState }) {
  const label =
    state === "init" ? "Initializing" : state === "up" ? "System nominal" : "Systems down";
  return (
    <span className="hidden items-center gap-1.5 md:inline-flex">
      <span className={cn("h-1.5 w-1.5 rounded-full", SYSTEM_DOT[state])} />
      <span className={cn("font-mono text-[10px] uppercase tracking-[0.16em]", SYSTEM_TEXT[state])}>
        {label}
      </span>
    </span>
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
        className="flex items-center gap-1.5 text-[#888f95] transition-colors hover:text-[#eef1f4]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2b3035] bg-[#121517] text-current">
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
            className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-md border border-[#2b3035] bg-[#1c2024] p-1 shadow-xl"
          >
            <p className="px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#6b7176]">
              Switch role
            </p>
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
                  "flex w-full items-center justify-between rounded px-2.5 py-1.5 transition-colors",
                  role === r
                    ? "bg-[#262b30] text-[#eef1f4]"
                    : "text-[#9aa1a6] hover:bg-[#202428] hover:text-[#eef1f4]",
                )}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-current">
                  {ROLE[r]}
                </span>
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
        "flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors",
        active
          ? "bg-[#262b30] text-[#eef1f4] ring-1 ring-inset ring-[#3a4046]"
          : "text-[#888f95] hover:bg-[#202428] hover:text-[#eef1f4]",
      )}
    >
      <Icon size={14} strokeWidth={1.8} />
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-current">
        {label}
      </span>
    </Link>
  );
}
