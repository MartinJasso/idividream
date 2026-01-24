"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Journey", href: "/journey" },
  { label: "Chat", href: "/chat" },
  { label: "Symbols", href: "/symbols" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4 text-slate-100">
        <div className="text-sm font-semibold tracking-wide text-slate-200">
          Idividream
        </div>
        <nav className="flex items-center gap-2 text-sm">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full border px-4 py-1.5 transition ${
                  isActive
                    ? "border-sky-400 bg-sky-500/10 text-sky-100"
                    : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-slate-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
