"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { db } from "../../db";
import { DEFAULT_MODEL, normalizeModel } from "../../model";
import type { AppSettings } from "../../types";

function nowIso() {
  return new Date().toISOString();
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [chatModelInput, setChatModelInput] = useState(DEFAULT_MODEL);
  const [extractModelInput, setExtractModelInput] = useState(DEFAULT_MODEL);
  const [summarizeModelInput, setSummarizeModelInput] = useState(DEFAULT_MODEL);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const settingsRow = await db.appSettings.get("global");
      if (!active) return;
      setSettings(settingsRow ?? null);
      setApiKeyInput(settingsRow?.openAiApiKey ?? "");
      setChatModelInput(normalizeModel(settingsRow?.modelChat));
      setExtractModelInput(normalizeModel(settingsRow?.modelExtract));
      setSummarizeModelInput(normalizeModel(settingsRow?.modelSummarize));
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    const trimmedKey = apiKeyInput.trim();
    const updated: AppSettings = {
      key: "global",
      currentNodeId: settings?.currentNodeId ?? undefined,
      currentSpiralOrder: settings?.currentSpiralOrder ?? undefined,
      openAiApiKey: trimmedKey ? trimmedKey : undefined,
      modelChat: normalizeModel(chatModelInput),
      modelExtract: normalizeModel(extractModelInput),
      modelSummarize: normalizeModel(summarizeModelInput),
      updatedAt: nowIso(),
    };
    await db.appSettings.put(updated);
    setSettings(updated);
    setApiKeyInput(updated.openAiApiKey ?? "");
    setChatModelInput(normalizeModel(updated.modelChat));
    setExtractModelInput(normalizeModel(updated.modelExtract));
    setSummarizeModelInput(normalizeModel(updated.modelSummarize));
    setStatus("Settings saved.");
    setTimeout(() => setStatus(null), 2000);
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">User settings</p>
          <h1 className="text-3xl font-semibold">API key &amp; models</h1>
        </div>
        <Link
          href="/journey"
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 hover:bg-slate-700"
        >
          Back to journey
        </Link>
      </header>

      <section className="mx-auto mt-8 w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="space-y-6">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              OpenAI API key
            </label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder="sk-..."
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <p className="mt-2 text-xs text-slate-400">
              Stored locally in your browser. The key is only sent with your model requests.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Chat model
              </label>
              <input
                value={chatModelInput}
                onChange={(event) => setChatModelInput(event.target.value)}
                placeholder={DEFAULT_MODEL}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Extract model
              </label>
              <input
                value={extractModelInput}
                onChange={(event) => setExtractModelInput(event.target.value)}
                placeholder={DEFAULT_MODEL}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Summarize model
              </label>
              <input
                value={summarizeModelInput}
                onChange={(event) => setSummarizeModelInput(event.target.value)}
                placeholder={DEFAULT_MODEL}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={handleSave}
              className="rounded-lg border border-sky-500/60 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/30"
            >
              Save settings
            </button>
            <div className="text-xs text-slate-400">
              Last updated: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : "—"}
            </div>
          </div>
          {status && <div className="text-xs text-emerald-300">{status}</div>}
        </div>
      </section>
    </main>
  );
}
