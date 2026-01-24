"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { db } from "../../db";
import { computeNodeStatuses } from "../../journey";
import { normalizeModel } from "../../model";
import { ensureUserNodeStateRows, seedNodeDefinitionsFromUrl } from "../../seed";
import type { AppSettings, ComputedNodeStatus, NodeDefinition } from "../../types";

const SAMPLE_CHAT_HISTORY = [
  {
    role: "user" as const,
    content: "I keep delaying the project even though it matters to me.",
  },
  {
    role: "assistant" as const,
    content: "When the delay shows up, what feeling or image do you notice first?",
  },
];

const SAMPLE_SUMMARY_HISTORY = [
  {
    role: "user" as const,
    content: "The procrastination feels like a heavy fog. I avoid hard tasks.",
  },
  {
    role: "assistant" as const,
    content: "You described the fog as protection. You want small steps to regain clarity.",
  },
  {
    role: "user" as const,
    content: "I committed to start with 20-minute focus blocks each morning.",
  },
];

const EXPECTED_CHAT_RESPONSE = {
  assistant:
    "It sounds like the delay arrives when the stakes feel heavy. What feels most at risk if you move forward today?",
};

const EXPECTED_SUMMARY_RESPONSE = {
  threadSummary: {
    threadId: "example-thread-id",
    summary:
      "User reports procrastination as a protective fog. They want small steps and commit to 20-minute focus blocks each morning.",
    keyMotifs: ["protective fog", "avoidance", "small steps", "morning focus blocks"],
    updatedAt: "2024-01-01T12:00:00.000Z",
  },
};

type ApiResult = {
  status: "idle" | "loading" | "success" | "error";
  message: string;
  payload?: unknown;
};

export default function DebugPage() {
  const [nodes, setNodes] = useState<NodeDefinition[]>([]);
  const [statusMap, setStatusMap] = useState<Map<string, ComputedNodeStatus>>(new Map());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [seedMessage, setSeedMessage] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [chatThreadId, setChatThreadId] = useState("debug-thread");
  const [summaryThreadId, setSummaryThreadId] = useState("debug-summary-thread");
  const [chatMessage, setChatMessage] = useState(
    "What is one small step I can take today to move this forward?"
  );

  const [chatResult, setChatResult] = useState<ApiResult>({
    status: "idle",
    message: "",
  });
  const [summaryResult, setSummaryResult] = useState<ApiResult>({
    status: "idle",
    message: "",
  });

  const selectedStatus = selectedNodeId ? statusMap.get(selectedNodeId) : null;

  useEffect(() => {
    setChatThreadId(crypto.randomUUID());
    setSummaryThreadId(crypto.randomUUID());
  }, []);

  const refreshData = async (forceSeed = false) => {
    setIsRefreshing(true);
    setSeedMessage("");
    try {
      const existingCount = await db.nodeDefinitions.count();
      if (existingCount === 0 || forceSeed) {
        const result = await seedNodeDefinitionsFromUrl("/nodes.json", { force: forceSeed });
        if (result.seeded) {
          setSeedMessage(`Seeded ${result.count} nodes from /nodes.json.`);
        } else {
          setSeedMessage("Seed skipped (already seeded).");
        }
      } else {
        setSeedMessage(`Nodes already present (${existingCount}).`);
      }

      await ensureUserNodeStateRows();

      const [nodeRows, statusEntries, settingsRow] = await Promise.all([
        db.nodeDefinitions.toArray(),
        computeNodeStatuses(),
        db.appSettings.get("global"),
      ]);

      setNodes(nodeRows);
      setStatusMap(new Map(statusEntries));
      setSettings(settingsRow ?? null);
      if (!selectedNodeId && nodeRows.length > 0) {
        setSelectedNodeId(nodeRows[0].id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh debug data.";
      setSeedMessage(message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFactoryReset = async () => {
    const confirmed = window.confirm(
      "This will erase all user data (threads, messages, settings, symbols). Continue?"
    );
    if (!confirmed) return;
    setIsResetting(true);
    setSeedMessage("");
    try {
      await Promise.all([
        db.userNodeStates.clear(),
        db.threads.clear(),
        db.messages.clear(),
        db.threadSummaries.clear(),
        db.symbols.clear(),
        db.personalSymbolMeanings.clear(),
        db.symbolOccurrences.clear(),
        db.appSettings.clear(),
      ]);
      setSelectedNodeId("");
      setChatResult({ status: "idle", message: "" });
      setSummaryResult({ status: "idle", message: "" });
      await refreshData(false);
      setSeedMessage("Factory reset complete. All user data erased.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to reset user data to factory settings.";
      setSeedMessage(message);
    } finally {
      setIsResetting(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const statusCounts = useMemo(() => {
    const counts = { completed: 0, next: 0, available: 0, locked: 0 };
    for (const entry of statusMap.values()) {
      counts[entry.status] += 1;
    }
    return counts;
  }, [statusMap]);

  const chatPayload = useMemo(
    () => ({
      nodeId: selectedNodeId,
      threadId: chatThreadId,
      userMessage: chatMessage,
      history: SAMPLE_CHAT_HISTORY,
      status: selectedStatus?.status ?? "unknown",
      unmetDependencies: selectedStatus?.unmetDependencies ?? [],
      currentNodeId: settings?.currentNodeId ?? null,
      currentSpiralOrder: settings?.currentSpiralOrder ?? null,
      apiKey: settings?.openAiApiKey ?? undefined,
      model: normalizeModel(settings?.modelChat),
    }),
    [chatMessage, chatThreadId, selectedNodeId, selectedStatus, settings]
  );

  const summaryPayload = useMemo(
    () => ({
      threadId: summaryThreadId,
      nodeId: selectedNodeId,
      nodeTitle: nodes.find((node) => node.id === selectedNodeId)?.title,
      promptTemplate: nodes.find((node) => node.id === selectedNodeId)?.prompt_template,
      status: selectedStatus?.status ?? "unknown",
      unmetDependencies: selectedStatus?.unmetDependencies ?? [],
      currentNodeId: settings?.currentNodeId ?? null,
      currentSpiralOrder: settings?.currentSpiralOrder ?? null,
      history: SAMPLE_SUMMARY_HISTORY,
      apiKey: settings?.openAiApiKey ?? undefined,
      model: normalizeModel(settings?.modelSummarize),
    }),
    [nodes, selectedNodeId, selectedStatus, settings, summaryThreadId]
  );

  const handleChatTest = async () => {
    setChatResult({ status: "loading", message: "Sending request to /api/chat…" });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatPayload),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Chat request failed.");
      }
      setChatResult({ status: "success", message: "Chat response received.", payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat request failed.";
      setChatResult({ status: "error", message });
    }
  };

  const handleSummaryTest = async () => {
    setSummaryResult({ status: "loading", message: "Sending request to /api/summarize…" });
    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summaryPayload),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Summarize request failed.");
      }
      setSummaryResult({ status: "success", message: "Summary response received.", payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Summarize request failed.";
      setSummaryResult({ status: "error", message });
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12 text-slate-100">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Debug console</p>
        <h1 className="text-4xl font-semibold">System diagnostics & sandbox</h1>
        <p className="text-sm text-slate-300">
          Use this route to validate key workflows with prefilled inputs, expected outputs, and
          guidance on what success looks like.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Seed & data health</h2>
            <p className="mt-1 text-sm text-slate-400">
              Ensures nodes.json is loaded and IndexedDB tables are populated.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => refreshData(false)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700"
              disabled={isRefreshing}
            >
              Refresh data
            </button>
            <button
              onClick={() => refreshData(true)}
              className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/20"
              disabled={isRefreshing}
            >
              Force reseed
            </button>
            <button
              onClick={handleFactoryReset}
              className="rounded-lg border border-rose-500/60 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/20"
              disabled={isRefreshing || isResetting}
            >
              Factory reset
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 text-sm text-slate-200 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase text-slate-400">Nodes</p>
            <p className="mt-2 text-2xl font-semibold">{nodes.length}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase text-slate-400">User node states</p>
            <p className="mt-2 text-2xl font-semibold">{nodes.length}</p>
            <p className="mt-1 text-xs text-slate-400">One row per node after seeding.</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase text-slate-400">Settings</p>
            <p className="mt-2 text-sm text-slate-200">
              Current node: {settings?.currentNodeId ?? "unset"}
            </p>
            <p className="text-xs text-slate-400">
              API key saved: {settings?.openAiApiKey ? "Yes" : "No"}
            </p>
          </div>
        </div>
        {seedMessage && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-2 text-xs text-slate-300">
            {seedMessage}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
        <h2 className="text-xl font-semibold">Journey status computation</h2>
        <p className="mt-1 text-sm text-slate-400">
          Confirms dependency logic and the recommended next node selection.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-5">
          {(["completed", "next", "available", "locked"] as const).map((status) => (
            <div key={status} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase text-slate-400">{status}</p>
              <p className="mt-2 text-2xl font-semibold">{statusCounts[status]}</p>
            </div>
          ))}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase text-slate-400">Recommended next</p>
            <p className="mt-2 text-sm text-slate-200">
              {Array.from(statusMap.values()).find((entry) => entry.status === "next")?.nodeId ??
                "None"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="text-xs uppercase text-slate-400">Inspect node</label>
          <select
            value={selectedNodeId}
            onChange={(event) => setSelectedNodeId(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title}
              </option>
            ))}
          </select>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200">
            Status: {selectedStatus?.status ?? "unknown"}
          </span>
          {selectedStatus?.unmetDependencies?.length ? (
            <span className="text-xs text-amber-200">
              Unmet: {selectedStatus.unmetDependencies.join(", ")}
            </span>
          ) : null}
        </div>
        <div className="mt-4 text-xs text-slate-400">
          Expected result: nodes with unmet dependencies show as locked; a single available node is
          flagged as next.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Chat API smoke test</h2>
            <p className="mt-1 text-sm text-slate-400">
              Sends a prefilled request to <span className="font-mono">/api/chat</span>.
            </p>
          </div>
          <button
            onClick={handleChatTest}
            className="rounded-lg border border-sky-500/60 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 hover:bg-sky-500/20"
            disabled={!selectedNodeId || chatResult.status === "loading"}
          >
            Run chat test
          </button>
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <label className="text-xs uppercase text-slate-400">Prefilled user message</label>
            <textarea
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
              className="min-h-[120px] w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase text-slate-400">Request payload</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-200">
                {JSON.stringify(chatPayload, null, 2)}
              </pre>
            </div>
          </div>
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase text-slate-400">Expected success response</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-200">
                {JSON.stringify(EXPECTED_CHAT_RESPONSE, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-slate-400">
                Success returns JSON with an <code>assistant</code> string. Errors usually indicate
                a missing API key or OpenAI auth failure.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase text-slate-400">Latest response</p>
              <p className="mt-1 text-xs text-slate-300">{chatResult.message}</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-200">
                {chatResult.payload ? JSON.stringify(chatResult.payload, null, 2) : "No response yet."}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Summarize API smoke test</h2>
            <p className="mt-1 text-sm text-slate-400">
              Sends a prefilled request to <span className="font-mono">/api/summarize</span>.
            </p>
          </div>
          <button
            onClick={handleSummaryTest}
            className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20"
            disabled={!selectedNodeId || summaryResult.status === "loading"}
          >
            Run summarize test
          </button>
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase text-slate-400">Request payload</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-200">
                {JSON.stringify(summaryPayload, null, 2)}
              </pre>
            </div>
            <p className="text-xs text-slate-400">
              Expected result: <code>threadSummary.summary</code> is non-empty and
              <code>keyMotifs</code> contains 5-12 short phrases.
            </p>
          </div>
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase text-slate-400">Expected success response</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-200">
                {JSON.stringify(EXPECTED_SUMMARY_RESPONSE, null, 2)}
              </pre>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase text-slate-400">Latest response</p>
              <p className="mt-1 text-xs text-slate-300">{summaryResult.message}</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-200">
                {summaryResult.payload
                  ? JSON.stringify(summaryResult.payload, null, 2)
                  : "No response yet."}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
        <h2 className="text-xl font-semibold">Explore the UI</h2>
        <p className="mt-1 text-sm text-slate-400">
          Validate the front-end experiences that sit on top of the data layer.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/journey"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700"
          >
            Open journey map
          </Link>
          <Link
            href={`/chat?nodeId=${selectedNodeId}`}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700"
          >
            Open node chat
          </Link>
        </div>
      </section>
    </main>
  );
}
