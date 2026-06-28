"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AIRPORT } from "@/lib/seed";
import { useStore } from "@/lib/store";
import { ROLE } from "@/lib/ui";
import { USER_ROLES } from "@/lib/types";

export default function Header() {
  const { role, setRole } = useStore();
  const pathname = usePathname();

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-5">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-900 text-xs font-bold text-white">
              Sx
            </span>
            <span className="text-sm font-semibold tracking-tight text-zinc-900">
              Strvx Runway Inspection
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink href="/" active={pathname === "/"}>
              Overview
            </NavLink>
            {(role === "inspector" || role === "admin") && (
              <NavLink href="/upload" active={pathname === "/upload"}>
                Upload
              </NavLink>
            )}
            {role === "admin" && (
              <NavLink href="/admin" active={pathname === "/admin"}>
                Admin
              </NavLink>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Role switcher — advisory RBAC, gates which actions render. */}
          <div className="flex items-center rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
            {USER_ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  role === r
                    ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                {ROLE[r]}
              </button>
            ))}
          </div>
          <span className="hidden text-xs text-zinc-500 sm:inline">
            {AIRPORT.name} · {AIRPORT.code}
          </span>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1 font-medium ${
        active
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
      }`}
    >
      {children}
    </Link>
  );
}
