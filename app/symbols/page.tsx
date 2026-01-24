"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../db";
import type { PersonalSymbolMeaning, SymbolDef, SymbolOccurrence } from "../../types";

type SortOption = "recent" | "frequency" | "alpha";

type SymbolRow = {
  symbol: SymbolDef;
  meaning: PersonalSymbolMeaning | null;
  occurrenceCount: number;
  lastUpdated: string;
};

const SORT_LABELS: Record<SortOption, string> = {
  recent: "Recently updated",
  frequency: "Most frequent",
  alpha: "Alphabetical",
};

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildMeaningPreview(meaning: string) {
  const trimmed = meaning.trim();
  if (!trimmed) return "Meaning not set";
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

export default function SymbolsLibraryPage() {
  const [rows, setRows] = useState<SymbolRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      const [symbols, meanings, occurrences] = await Promise.all([
        db.symbols.toArray(),
        db.personalSymbolMeanings.toArray(),
        db.symbolOccurrences.toArray(),
      ]);

      const meaningsById = new Map<string, PersonalSymbolMeaning>();
      meanings.forEach((meaning) => meaningsById.set(meaning.symbolId, meaning));

      const occurrencesBySymbol = new Map<string, SymbolOccurrence[]>();
      occurrences.forEach((occurrence) => {
        const bucket = occurrencesBySymbol.get(occurrence.symbolId) ?? [];
        bucket.push(occurrence);
        occurrencesBySymbol.set(occurrence.symbolId, bucket);
      });

      const nextRows = symbols.map((symbol) => {
        const meaning = meaningsById.get(symbol.id) ?? null;
        const symbolOccurrences = occurrencesBySymbol.get(symbol.id) ?? [];
        const lastUpdated = meaning?.lastUpdated ?? symbol.createdAt;
        return {
          symbol,
          meaning,
          occurrenceCount: symbolOccurrences.length,
          lastUpdated,
        };
      });

      if (!active) return;
      setRows(nextRows);
      setIsLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(() => {
    const values = new Set<string>();
    rows.forEach((row) => {
      if (row.symbol.category) {
        values.add(row.symbol.category);
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const categoryMatches =
        categoryFilter === "all" || row.symbol.category === categoryFilter;
      if (!categoryMatches) return false;
      if (!query) return true;
      const meaningText = row.meaning?.personalMeaning ?? "";
      return (
        row.symbol.label.toLowerCase().includes(query) ||
        meaningText.toLowerCase().includes(query)
      );
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === "alpha") {
        return a.symbol.label.localeCompare(b.symbol.label);
      }
      if (sortBy === "frequency") {
        return b.occurrenceCount - a.occurrenceCount;
      }
      const dateA = new Date(a.lastUpdated).getTime();
      const dateB = new Date(b.lastUpdated).getTime();
      return dateB - dateA;
    });

    return sorted;
  }, [rows, searchTerm, categoryFilter, sortBy]);

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-slate-800 bg-slate-950/90 px-6 py-6 text-slate-100">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Personal Library</p>
          <h1 className="text-3xl font-semibold">Symbols</h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Browse your extracted dream symbols, add personal meaning, and review the evidence
            behind each motif.
          </p>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex flex-1 flex-col gap-2 text-sm text-slate-300">
              Search
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search symbols or personal meanings..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </label>
            <label className="flex min-w-[180px] flex-col gap-2 text-sm text-slate-300">
              Category
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[200px] flex-col gap-2 text-sm text-slate-300">
              Sort by
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortOption)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="text-xs text-slate-400">
            {rows.length} symbols • {filteredRows.length} match current filters
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-400">
            Loading symbols…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-300">
            <p className="text-base font-semibold text-slate-200">No symbols yet</p>
            <p className="mt-2 text-sm text-slate-400">
              Extract symbols from a dream in chat to populate your personal library.
            </p>
            <Link
              href="/chat"
              className="mt-4 inline-flex items-center justify-center rounded-full border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-100 hover:border-slate-400"
            >
              Go to Chat
            </Link>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-300">
            No symbols match your search or filters.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-800">
            <div className="grid grid-cols-[2fr_1fr_3fr_1fr_1fr] gap-4 border-b border-slate-800 bg-slate-900/60 px-4 py-3 text-xs uppercase tracking-wide text-slate-400">
              <div>Symbol</div>
              <div>Category</div>
              <div>Meaning</div>
              <div className="text-center">Occurrences</div>
              <div>Updated</div>
            </div>
            <ul className="divide-y divide-slate-800 bg-slate-950/40">
              {filteredRows.map((row) => (
                <li key={row.symbol.id}>
                  <Link
                    href={`/symbols/${row.symbol.id}`}
                    className="grid grid-cols-[2fr_1fr_3fr_1fr_1fr] gap-4 px-4 py-4 text-sm text-slate-100 transition hover:bg-slate-900/60"
                  >
                    <div className="font-semibold text-slate-100">{row.symbol.label}</div>
                    <div className="text-slate-300">{row.symbol.category ?? "—"}</div>
                    <div className="text-slate-300">
                      {buildMeaningPreview(row.meaning?.personalMeaning ?? "")}
                    </div>
                    <div className="text-center text-slate-200">{row.occurrenceCount}</div>
                    <div className="text-slate-400">{formatDate(row.lastUpdated)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
