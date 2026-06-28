"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Upload, Cog, type LucideIcon } from "lucide-react";
import { AIRPORT } from "@/lib/seed";
import { useStore } from "@/lib/store";
import { ROLE } from "@/lib/ui";
import { USER_ROLES } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Persistent navigable top bar — mirrors the Valanor console Header. */
export default function Header() {
  const { role, setRole } = useStore();
  const pathname = usePathname();
  const showUpload = role === "inspector" || role === "admin";
  const showAdmin = role === "admin";

  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center border-b border-white/10 bg-panel/95 px-4 backdrop-blur">
      {/* brand */}
      <Link href="/" className="flex items-center gap-2.5">
        <img src="/valanor-wordmark.png" alt="Valanor" className="h-[30px] w-auto" />
        <span className="label hidden text-[9px] text-ink-faint sm:inline">
          Airport Inspection
        </span>
      </Link>

      {/* view nav — centered */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-0.5">
        <NavTab href="/" active={pathname === "/"} icon={Gauge} label="Overview" />
        {showUpload && (
          <NavTab href="/upload" active={pathname === "/upload"} icon={Upload} label="Upload" />
        )}
        {showAdmin && (
          <NavTab href="/admin" active={pathname === "/admin"} icon={Cog} label="Admin" />
        )}
      </div>

      {/* status — role switcher + airport */}
      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-0.5">
          {USER_ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                role === r ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink",
              )}
            >
              <span className="label text-[9px] text-current">{ROLE[r]}</span>
            </button>
          ))}
        </div>
        <div className="hidden flex-col items-end leading-tight sm:flex">
          <span className="label text-[8px]">Airport</span>
          <span className="tnum text-[12px] text-ink">{AIRPORT.code}</span>
        </div>
      </div>
    </header>
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
