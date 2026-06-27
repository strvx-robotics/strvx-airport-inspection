import Link from "next/link";
import { AIRPORT } from "@/lib/seed";

export default function Header() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-900 text-xs font-bold text-white">
            Sx
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-900">
            Strvx Runway Inspection
          </span>
        </Link>
        <span className="text-xs text-zinc-500">
          {AIRPORT.name} · {AIRPORT.code}
        </span>
      </div>
    </header>
  );
}
