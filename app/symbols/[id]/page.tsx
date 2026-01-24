"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db";
import type {
  NodeDefinition,
  PersonalSymbolMeaning,
  SymbolDef,
  SymbolOccurrence,
} from "../../../types";

const VALENCE_OPTIONS = [-2, -1, 0, 1, 2];

function formatDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SymbolDetailPage() {
  const params = useParams<{ id: string }>();
  const symbolId = params?.id ?? "";
  const [symbol, setSymbol] = useState<SymbolDef | null>(null);
  const [meaning, setMeaning] = useState<PersonalSymbolMeaning | null>(null);
  const [occurrences, setOccurrences] = useState<SymbolOccurrence[]>([]);
  const [nodeTitles, setNodeTitles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [draftMeaning, setDraftMeaning] = useState("");
  const [draftValence, setDraftValence] = useState<number | null>(null);
  const [draftDomains, setDraftDomains] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!symbolId) return;
      setIsLoading(true);
      const [symbolRow, meaningRow, occurrenceRows] = await Promise.all([
        db.symbols.get(symbolId),
        db.personalSymbolMeanings.get(symbolId),
        db.symbolOccurrences.where("symbolId").equals(symbolId).toArray(),
      ]);

      if (!active) return;
      setSymbol(symbolRow ?? null);
      setMeaning(meaningRow ?? null);

      const sorted = occurrenceRows.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });
      setOccurrences(sorted);

      const nodeIds = Array.from(new Set(sorted.map((row) => row.nodeId)));
      if (nodeIds.length) {
        const nodes = await db.nodeDefinitions.bulkGet(nodeIds);
        if (!active) return;
        const titles: Record<string, string> = {};
        nodes.forEach((node) => {
          if (node?.id) {
            titles[node.id] = node.title;
          }
        });
        setNodeTitles(titles);
      } else {
        setNodeTitles({});
      }

      setIsLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [symbolId]);

  useEffect(() => {
    setDraftMeaning(meaning?.personalMeaning ?? "");
    setDraftValence(meaning?.valence ?? null);
    setDraftDomains((meaning?.linkedDomains ?? []).join(", "));
  }, [meaning]);

  const meaningPreview = useMemo(() => {
    return meaning?.personalMeaning?.trim();
  }, [meaning]);

  const handleSave = async () => {
    if (!symbol) return;
    setSaveStatus("saving");
    const trimmedMeaning = draftMeaning.trim();
    const domains = draftDomains
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const now = new Date().toISOString();
    const updated: PersonalSymbolMeaning = {
      ...(meaning ?? { symbolId }),
      symbolId,
      personalMeaning: trimmedMeaning,
      valence: draftValence ?? undefined,
      linkedDomains: domains.length ? domains : undefined,
      lastUpdated: now,
    };
    await db.personalSymbolMeanings.put(updated);
    setMeaning(updated);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  if (!symbolId) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-10 text-slate-300">
        No symbol selected.
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-10 text-slate-300">
        Loading symbol…
      </main>
    );
  }

  if (!symbol) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-slate-300">
        <p className="text-lg font-semibold text-slate-100">Symbol not found.</p>
        <Link
          href="/symbols"
          className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
        >
          Back to symbols
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-slate-800 bg-slate-950/90 px-6 py-6 text-slate-100">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <Link href="/symbols" className="text-xs text-slate-400 hover:text-slate-200">
            ← Back to library
          </Link>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Symbol</p>
            <h1 className="text-3xl font-semibold">{symbol.label}</h1>
            <p className="text-sm text-slate-400">{symbol.category ?? "Uncategorized"}</p>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-slate-100">Personal meaning</h2>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-full border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-100 hover:border-slate-400"
              >
                {saveStatus === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
            {!meaningPreview && (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">
                No personal meaning yet. Add one below to personalize this symbol.
              </div>
            )}
            <label className="flex flex-col gap-2 text-sm text-slate-300">
              Your meaning
              <textarea
                value={draftMeaning}
                onChange={(event) => setDraftMeaning(event.target.value)}
                rows={4}
                placeholder="Describe what this symbol means to you..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </label>
            <div className="flex flex-col gap-3 text-sm text-slate-300">
              <span>Valence</span>
              <div className="flex flex-wrap gap-2">
                {VALENCE_OPTIONS.map((value) => {
                  const isActive = draftValence === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDraftValence(value)}
                      className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? "border-sky-400 bg-sky-500/10 text-sky-100"
                          : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-slate-100"
                      }`}
                    >
                      {value > 0 ? `+${value}` : value}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setDraftValence(null)}
                  className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-slate-100"
                >
                  Clear
                </button>
              </div>
            </div>
            <label className="flex flex-col gap-2 text-sm text-slate-300">
              Linked domains (comma-separated)
              <input
                value={draftDomains}
                onChange={(event) => setDraftDomains(event.target.value)}
                placeholder="e.g. family, career, health"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </label>
            {saveStatus === "saved" && (
              <p className="text-xs text-emerald-400">Saved just now.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-lg font-semibold text-slate-100">Evidence</h2>
          <p className="text-sm text-slate-400">
            {occurrences.length} occurrences found in your conversations.
          </p>
          {occurrences.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">
              No evidence yet. Extract symbols from chats to populate evidence here.
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {occurrences.map((occurrence) => (
                <li
                  key={occurrence.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>{formatDateTime(occurrence.createdAt)}</span>
                    <span>
                      {nodeTitles[occurrence.nodeId]
                        ? `${nodeTitles[occurrence.nodeId]} • ${occurrence.nodeId}`
                        : occurrence.nodeId}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-200">“{occurrence.contextSnippet}”</p>
                  {occurrence.emotionTags?.length ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Emotions: {occurrence.emotionTags.join(", ")}
                    </p>
                  ) : null}
                  <Link
                    href={`/chat?nodeId=${occurrence.nodeId}`}
                    className="mt-3 inline-flex text-xs font-semibold text-sky-300 hover:text-sky-200"
                  >
                    Open in chat →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
