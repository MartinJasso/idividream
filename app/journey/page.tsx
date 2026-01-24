"use client";

import JourneyMapCanvas from "../../components/JourneyMapCanvas";

const legendItems = [
  { label: "Completed", className: "bg-emerald-500" },
  { label: "Next", className: "border border-yellow-400" },
  { label: "Available", className: "bg-sky-400" },
  { label: "Locked", className: "bg-slate-600" },
];

export default function JourneyPage() {
  return (
    <main className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-6 py-4 text-slate-100">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Journey Map</p>
          <h1 className="text-2xl font-semibold">Spiral + Tree Overview</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span
                className={`h-3 w-3 rounded-full ${item.className}`}
                aria-hidden
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </header>
      <section className="relative flex-1">
        <JourneyMapCanvas />
      </section>
    </main>
  );
}
