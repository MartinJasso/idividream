"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../db";
import { computeNodeStatuses, getGlobalSettings } from "../../journey";
import { normalizeModel } from "../../model";
import { ensureUserNodeStateRows, seedNodeDefinitionsFromUrl } from "../../seed";
import { renderFirstTimePrompt } from "../../src/config/firstTimePrompts";
import type {
  AppSettings,
  ComputedNodeStatus,
  Message,
  NodeDefinition,
  PersonalSymbolMeaning,
  Thread,
  ThreadSummary,
} from "../../types";

const STATUS_LABELS: Record<ComputedNodeStatus["status"], string> = {
  completed: "Completed",
  next: "Next",
  available: "Available",
  locked: "Locked",
};

function nowIso() {
  return new Date().toISOString();
}

function formatThreadTitle(nodeTitle: string) {
  const date = new Date();
  return `${nodeTitle} – ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

type DreamScene = {
  idx: number;
  summary: string;
  emotions: string[];
};

type DreamSymbol = {
  label: string;
  category?: "place" | "object" | "person" | "animal" | "action" | "emotion" | "other";
  contextSnippet: string;
  emotionTags: string[];
};

type DreamRelevance = {
  nextNodeId: string | null;
  nextNodeTitle: string | null;
  hypotheses: string[];
};

type DreamExtraction = {
  scenes: DreamScene[];
  symbols: DreamSymbol[];
  relevance: DreamRelevance;
  clarifyingQuestion: string;
};

type DreamExtractionRecord = {
  status: "pending" | "ready" | "error";
  data?: DreamExtraction;
  error?: string;
  assistantMessageId?: string;
  personalMeanings?: Record<string, PersonalSymbolMeaning | null>;
};

type SymbolMeaningContext = {
  symbolId: string;
  label: string;
  personalMeaning: string;
  valence?: number;
  confidence?: number;
};

function slugifySymbol(label: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "symbol";
}

export default function ChatPageRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nodeId = searchParams.get("nodeId");
  const [node, setNode] = useState<NodeDefinition | null>(null);
  const [status, setStatus] = useState<ComputedNodeStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [nextNode, setNextNode] = useState<{
    id: string;
    title: string;
    promptTemplate?: string;
  } | null>(null);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadSummary, setThreadSummary] = useState<ThreadSummary | null>(null);

  const [composer, setComposer] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dreamExtractions, setDreamExtractions] = useState<Record<string, DreamExtractionRecord>>(
    {}
  );
  const [symbolEditorByMessage, setSymbolEditorByMessage] = useState<Record<string, string | null>>(
    {}
  );
  const [symbolDrafts, setSymbolDrafts] = useState<
    Record<string, { personalMeaning: string; valence: string }>
  >({});

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const seededRef = useRef(false);
  const initAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (nodeId) return;
    let active = true;

    const resolveNode = async () => {
      if (!seededRef.current) {
        seededRef.current = true;
        await seedNodeDefinitionsFromUrl("/nodes.json");
        await ensureUserNodeStateRows();
      }

      const [settingsRow, statusMap] = await Promise.all([
        getGlobalSettings(),
        computeNodeStatuses(),
      ]);

      if (!active) return;
      const nextNodeId =
        settingsRow?.currentNodeId ??
        Array.from(statusMap.values()).find((statusRow) => statusRow.status === "next")
          ?.nodeId ??
        null;

      if (nextNodeId) {
        router.replace(`/chat?nodeId=${nextNodeId}`);
      }
    };

    resolveNode();

    return () => {
      active = false;
    };
  }, [nodeId, router]);

  useEffect(() => {
    if (!nodeId) return;
    let active = true;

    const load = async () => {
      if (!seededRef.current) {
        seededRef.current = true;
        await seedNodeDefinitionsFromUrl("/nodes.json");
        await ensureUserNodeStateRows();
      }

      const [nodeRow, statusMap, settingsRow] = await Promise.all([
        db.nodeDefinitions.get(nodeId),
        computeNodeStatuses(),
        db.appSettings.get("global"),
      ]);

      if (!active) return;
      setNode(nodeRow ?? null);
      setStatus(statusMap.get(nodeId) ?? null);
      setSettings(settingsRow ?? null);

      const nextEntry = Array.from(statusMap.values()).find((entry) => entry.status === "next");
      if (nextEntry) {
        const nextNodeRow = await db.nodeDefinitions.get(nextEntry.nodeId);
        if (!active) return;
        setNextNode(
          nextNodeRow
            ? {
                id: nextNodeRow.id,
                title: nextNodeRow.title,
                promptTemplate: nextNodeRow.prompt_template,
              }
            : null
        );
      } else {
        setNextNode(null);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId) return;
    let active = true;
    const loadThreads = async () => {
      const results = await db.threads.where("nodeId").equals(nodeId).sortBy("updatedAt");
      const ordered = results.reverse();
      if (!active) return;
      setThreads(ordered);

      if (ordered.length === 0) {
        if (!node) {
          setSelectedThreadId(null);
          return;
        }
        const id = crypto.randomUUID();
        const timestamp = nowIso();
        const newThread: Thread = {
          id,
          nodeId: node.id,
          title: `${node.title} – First session`,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await db.threads.put(newThread);
        if (!active) return;
        setThreads([newThread]);
        setSelectedThreadId(id);
        void initializeThreadIfFirstTime(nodeId, id);
        return;
      }

      const nextSelectedId =
        selectedThreadId && ordered.some((thread) => thread.id === selectedThreadId)
          ? selectedThreadId
          : ordered[0].id;
      setSelectedThreadId(nextSelectedId);

      const messageCount = await db.messages.where("threadId").equals(nextSelectedId).count();
      if (!active) return;
      if (messageCount === 0) {
        void initializeThreadIfFirstTime(nodeId, nextSelectedId);
      }
    };
    loadThreads();
    return () => {
      active = false;
    };
  }, [nodeId, node, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      setThreadSummary(null);
      return;
    }
    let active = true;
    const loadMessages = async () => {
      const results = await db.messages
        .where("threadId")
        .equals(selectedThreadId)
        .sortBy("createdAt");
      if (!active) return;
      setMessages(results);
    };
    loadMessages();
    return () => {
      active = false;
    };
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) {
      setThreadSummary(null);
      return;
    }
    let active = true;
    const loadSummary = async () => {
      const summary = await db.threadSummaries.get(selectedThreadId);
      if (!active) return;
      setThreadSummary(summary ?? null);
    };
    loadSummary();
    return () => {
      active = false;
    };
  }, [selectedThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const visibleMessages = useMemo(
    () => messages.filter((message) => !message.metadata?.hidden),
    [messages]
  );

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

  const extractionByAssistantId = useMemo(() => {
    const map = new Map<string, { messageId: string; record: DreamExtractionRecord }>();
    Object.entries(dreamExtractions).forEach(([messageId, record]) => {
      if (record.assistantMessageId) {
        map.set(record.assistantMessageId, { messageId, record });
      }
    });
    return map;
  }, [dreamExtractions]);

  const handleNewThread = async () => {
    if (!node) return;
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const newThread: Thread = {
      id,
      nodeId: node.id,
      title: formatThreadTitle(node.title),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.threads.put(newThread);
    setThreads((prev) => [newThread, ...prev]);
    setSelectedThreadId(id);
  };

  const updateThreadTimestamp = async (threadId: string) => {
    const thread = await db.threads.get(threadId);
    if (!thread) return;
    const updated = { ...thread, updatedAt: nowIso() };
    await db.threads.put(updated);
    setThreads((prev) => {
      const next = prev.map((item) => (item.id === threadId ? updated : item));
      return next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    });
  };

  async function initializeThreadIfFirstTime(targetNodeId: string, threadId: string) {
    if (initAttemptedRef.current.has(threadId)) return;
    initAttemptedRef.current.add(threadId);
    setIsInitializing(true);
    setErrorMessage(null);

    try {
      const nodeRow = await db.nodeDefinitions.get(targetNodeId);
      if (!nodeRow) return;
      const initPrompt = renderFirstTimePrompt(nodeRow);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: targetNodeId,
          threadId,
          userMessage: initPrompt,
          status: status?.status ?? "locked",
          unmetDependencies: status?.unmetDependencies ?? [],
          currentNodeId: settings?.currentNodeId ?? null,
          currentSpiralOrder: settings?.currentSpiralOrder ?? null,
          nextNode,
          apiKey: settings?.openAiApiKey,
          model: normalizeModel(settings?.modelChat),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Failed to reach the model");
      }

      const data = await response.json();
      const assistantText = String(data?.assistant ?? "").trim();
      if (!assistantText) {
        throw new Error("No assistant response returned.");
      }

      const initUserMessage: Message = {
        id: crypto.randomUUID(),
        threadId,
        role: "user",
        content: initPrompt,
        createdAt: nowIso(),
        metadata: { hidden: true, kind: "init_prompt" },
      };
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        threadId,
        role: "assistant",
        content: assistantText,
        createdAt: nowIso(),
        metadata: { kind: "init_assistant" },
      };

      await db.messages.put(initUserMessage);
      await db.messages.put(assistantMessage);
      setMessages((prev) => [...prev, initUserMessage, assistantMessage]);
      await updateThreadTimestamp(threadId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize thread.";
      setErrorMessage(message);
    } finally {
      setIsInitializing(false);
    }
  }

  const shouldSummarize = (threadMessages: Message[]) => {
    const totalChars = threadMessages.reduce((acc, msg) => acc + msg.content.length, 0);
    return threadMessages.length > 40 || totalChars > 12000;
  };

  const requestSummarize = async (threadMessages: Message[]) => {
    if (!node || !selectedThreadId) return;
    const response = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: selectedThreadId,
        nodeId: node.id,
        nodeTitle: node.title,
        promptTemplate: node.prompt_template,
        status: status?.status ?? "locked",
        unmetDependencies: status?.unmetDependencies ?? [],
        currentNodeId: settings?.currentNodeId ?? null,
        currentSpiralOrder: settings?.currentSpiralOrder ?? null,
        nextNode,
        history: threadMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        existingSummary: threadSummary,
        apiKey: settings?.openAiApiKey,
        model: normalizeModel(settings?.modelChat),
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error ?? "Failed to summarize thread.");
    }

    const data = await response.json();
    const summary = data?.threadSummary as ThreadSummary | undefined;
    if (summary) {
      await db.threadSummaries.put(summary);
      setThreadSummary(summary);
    }
  };

  const buildSymbolMeaningContext = async (dreamText: string) => {
    const lower = dreamText.toLowerCase();
    const [symbols, meanings] = await Promise.all([
      db.symbols.toArray(),
      db.personalSymbolMeanings.toArray(),
    ]);
    const meaningsById = new Map<string, PersonalSymbolMeaning>();
    meanings.forEach((row) => meaningsById.set(row.symbolId, row));

    const matched: SymbolMeaningContext[] = [];
    symbols.forEach((symbol) => {
      if (!symbol.label) return;
      if (!lower.includes(symbol.label.toLowerCase())) return;
      const meaning = meaningsById.get(symbol.id);
      if (!meaning || !meaning.personalMeaning.trim()) return;
      matched.push({
        symbolId: symbol.id,
        label: symbol.label,
        personalMeaning: meaning.personalMeaning,
        valence: meaning.valence,
        confidence: meaning.confidence,
      });
    });

    return matched.slice(0, 12);
  };

  const persistDreamExtraction = async (extraction: DreamExtraction, messageId: string) => {
    if (!node) return {};
    const createdAt = nowIso();
    const personalMeanings: Record<string, PersonalSymbolMeaning | null> = {};

    for (const symbol of extraction.symbols) {
      const symbolId = slugifySymbol(symbol.label);
      const existingSymbol = await db.symbols.get(symbolId);
      await db.symbols.put({
        id: symbolId,
        label: symbol.label,
        category: symbol.category,
        globalNotes: existingSymbol?.globalNotes,
        createdAt: existingSymbol?.createdAt ?? createdAt,
      });

      await db.symbolOccurrences.put({
        id: crypto.randomUUID(),
        symbolId,
        messageId,
        nodeId: node.id,
        contextSnippet: symbol.contextSnippet,
        emotionTags: symbol.emotionTags,
        createdAt,
      });

      const existingMeaning = await db.personalSymbolMeanings.get(symbolId);
      if (!existingMeaning) {
        const placeholder: PersonalSymbolMeaning = {
          symbolId,
          personalMeaning: "",
          confidence: 0.2,
          lastUpdated: createdAt,
        };
        await db.personalSymbolMeanings.put(placeholder);
        personalMeanings[symbolId] = placeholder;
      } else {
        personalMeanings[symbolId] = existingMeaning;
      }
    }

    return personalMeanings;
  };

  const triggerDreamExtraction = async (messageId: string, dreamText: string) => {
    if (!node || !selectedThreadId) return;
    setDreamExtractions((prev) => ({
      ...prev,
      [messageId]: {
        status: "pending",
        assistantMessageId: prev[messageId]?.assistantMessageId,
      },
    }));

    try {
      const personalSymbolMeanings = await buildSymbolMeaningContext(dreamText);
      const response = await fetch("/api/extract-dream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: node.id,
          threadId: selectedThreadId,
          messageId,
          dreamText,
          nodeTitle: node.title,
          nodePromptTemplate: node.prompt_template,
          nextNode: nextNode
            ? {
                id: nextNode.id,
                title: nextNode.title,
                promptTemplate: nextNode.promptTemplate,
              }
            : null,
          personalSymbolMeanings,
          apiKey: settings?.openAiApiKey,
          model: normalizeModel(settings?.modelExtract),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Failed to extract dream symbols.");
      }

      const data = (await response.json()) as DreamExtraction;
      const personalMeanings = await persistDreamExtraction(data, messageId);

      setDreamExtractions((prev) => ({
        ...prev,
        [messageId]: {
          ...prev[messageId],
          status: "ready",
          data,
          personalMeanings,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to extract dream symbols.";
      setDreamExtractions((prev) => ({
        ...prev,
        [messageId]: {
          ...prev[messageId],
          status: "error",
          error: message,
        },
      }));
    }
  };

  const openSymbolEditor = (
    messageId: string,
    symbolId: string,
    meaning: PersonalSymbolMeaning | null | undefined
  ) => {
    setSymbolEditorByMessage((prev) => ({
      ...prev,
      [messageId]: prev[messageId] === symbolId ? null : symbolId,
    }));
    const key = `${messageId}:${symbolId}`;
    setSymbolDrafts((prev) => {
      if (prev[key]) return prev;
      return {
        ...prev,
        [key]: {
          personalMeaning: meaning?.personalMeaning ?? "",
          valence: typeof meaning?.valence === "number" ? String(meaning.valence) : "",
        },
      };
    });
  };

  const handleSaveSymbolMeaning = async (messageId: string, symbolId: string) => {
    const key = `${messageId}:${symbolId}`;
    const draft = symbolDrafts[key];
    if (!draft) return;
    const parsedValence =
      draft.valence.trim() === "" ? undefined : Math.max(-2, Math.min(2, Number(draft.valence)));
    const valence = Number.isNaN(parsedValence) ? undefined : parsedValence;

    const existing = await db.personalSymbolMeanings.get(symbolId);
    const updated: PersonalSymbolMeaning = {
      symbolId,
      personalMeaning: draft.personalMeaning.trim(),
      valence,
      confidence: existing?.confidence ?? 0.2,
      lastUpdated: nowIso(),
    };
    await db.personalSymbolMeanings.put(updated);

    setDreamExtractions((prev) => {
      const record = prev[messageId];
      if (!record) return prev;
      return {
        ...prev,
        [messageId]: {
          ...record,
          personalMeanings: {
            ...(record.personalMeanings ?? {}),
            [symbolId]: updated,
          },
        },
      };
    });
    setSymbolEditorByMessage((prev) => ({ ...prev, [messageId]: null }));
  };

  const handleSend = async () => {
    if (!node || !selectedThreadId || !composer.trim()) return;
    if (isSending || isInitializing) return;

    const messageText = composer.trim();
    const dreamModeEnabled = true;
    setComposer("");
    setErrorMessage(null);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      threadId: selectedThreadId,
      role: "user",
      content: messageText,
      createdAt: nowIso(),
    };

    setMessages((prev) => [...prev, userMessage]);
    await db.messages.put(userMessage);
    await updateThreadTimestamp(selectedThreadId);

    setIsSending(true);
    try {
      if (dreamModeEnabled) {
        void triggerDreamExtraction(userMessage.id, messageText);
      }
      const historySnapshot = [...messages, userMessage].map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: node.id,
          threadId: selectedThreadId,
          userMessage: messageText,
          nodeTitle: node.title,
          promptTemplate: node.prompt_template,
          status: status?.status ?? "locked",
          unmetDependencies: status?.unmetDependencies ?? [],
          currentNodeId: settings?.currentNodeId ?? null,
          currentSpiralOrder: settings?.currentSpiralOrder ?? null,
          nextNode,
          history: historySnapshot,
          threadSummary,
          apiKey: settings?.openAiApiKey,
          model: normalizeModel(settings?.modelChat),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Failed to reach the model");
      }

      const data = await response.json();
      const assistantText = String(data?.assistant ?? "").trim();
      if (!assistantText) {
        throw new Error("No assistant response returned.");
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        threadId: selectedThreadId,
        role: "assistant",
        content: assistantText,
        createdAt: nowIso(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      await db.messages.put(assistantMessage);
      await updateThreadTimestamp(selectedThreadId);
      setIsSending(false);
      if (dreamModeEnabled) {
        setDreamExtractions((prev) => ({
          ...prev,
          [userMessage.id]: {
            ...(prev[userMessage.id] ?? { status: "pending" }),
            assistantMessageId: assistantMessage.id,
          },
        }));
      }

      const updatedMessages = [...messages, userMessage, assistantMessage];
      if (shouldSummarize(updatedMessages)) {
        void requestSummarize(updatedMessages).catch((error) => {
          const message = error instanceof Error ? error.message : "Failed to summarize thread.";
          setErrorMessage(message);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send message.";
      setErrorMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleSummarizeNow = async () => {
    if (!selectedThreadId || messages.length === 0) return;
    setErrorMessage(null);
    try {
      await requestSummarize(messages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to summarize thread.";
      setErrorMessage(message);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  if (!nodeId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-300">
        Resolving your current node…
      </div>
    );
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Node chat</p>
          <h1 className="text-2xl font-semibold text-slate-100">{node?.title ?? "Loading…"}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200">
            {STATUS_LABELS[status?.status ?? "locked"]}
          </span>
          <Link
            href="/settings"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700"
          >
            Settings
          </Link>
          <Link
            href="/journey"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-100 hover:bg-slate-700"
          >
            Back to journey
          </Link>
        </div>
      </header>

      {status?.status === "locked" && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          This node is locked, but you can still chat. Unmet dependencies: {status.unmetDependencies?.length
            ? status.unmetDependencies.join(", ")
            : "None"}.
        </div>
      )}

      <section className="flex flex-1 overflow-hidden">
        <aside className="flex w-72 flex-col border-r border-slate-800 bg-slate-950/80 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Threads</h2>
            <button
              onClick={handleNewThread}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 hover:bg-slate-700"
            >
              New chat
            </button>
          </div>
          <div className="mt-4 flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <p className="text-xs text-slate-400">No chats yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {threads.map((thread) => (
                  <li key={thread.id}>
                    <button
                      onClick={() => setSelectedThreadId(thread.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                        thread.id === selectedThreadId
                          ? "border-sky-500/60 bg-sky-500/10 text-sky-100"
                          : "border-slate-800 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
                      }`}
                    >
                      <div className="font-medium">{thread.title}</div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        {new Date(thread.updatedAt).toLocaleString()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {!selectedThread ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-300">
                Select a chat or start a new one to begin.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold uppercase tracking-wide text-slate-400">
                      Summary
                    </div>
                    <button
                      onClick={handleSummarizeNow}
                      className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-700"
                    >
                      Summarize now
                    </button>
                  </div>
                  {threadSummary ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-slate-300">
                        View summary &amp; key motifs
                      </summary>
                      <div className="mt-2 whitespace-pre-wrap text-slate-200">
                        {threadSummary.summary}
                      </div>
                      {threadSummary.keyMotifs?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {threadSummary.keyMotifs.map((motif) => (
                            <span
                              key={motif}
                              className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200"
                            >
                              {motif}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-2 text-[11px] text-slate-500">
                        Updated {new Date(threadSummary.updatedAt).toLocaleString()}
                      </div>
                    </details>
                  ) : (
                    <p className="mt-2 text-slate-400">No summary yet.</p>
                  )}
                </div>
                {isInitializing && (
                  <div className="max-w-2xl rounded-2xl bg-slate-900 px-4 py-3 text-sm text-slate-300">
                    Preparing your first step…
                  </div>
                )}
                {visibleMessages.map((message) => (
                  <div key={message.id} className="flex flex-col gap-2">
                    <div
                      className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        message.role === "user"
                          ? "ml-auto bg-sky-500/20 text-sky-100"
                          : "bg-slate-900 text-slate-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                    {message.role === "user" &&
                      dreamExtractions[message.id]?.status === "pending" &&
                      !dreamExtractions[message.id]?.assistantMessageId && (
                        <div className="ml-auto text-xs text-slate-400">Extracting…</div>
                      )}
                    {message.role === "assistant" &&
                      extractionByAssistantId.has(message.id) && (
                        <div className="max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-200">
                          {(() => {
                            const entry = extractionByAssistantId.get(message.id);
                            if (!entry) return null;
                            const record = entry.record;
                            if (record.status === "pending") {
                              return (
                                <div className="flex items-center justify-between text-slate-300">
                                  <span className="font-semibold text-slate-200">
                                    Dream extraction
                                  </span>
                                  <span>Extracting…</span>
                                </div>
                              );
                            }
                            if (record.status === "error") {
                              return (
                                <div>
                                  <div className="font-semibold text-slate-200">
                                    Dream extraction
                                  </div>
                                  <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-200">
                                    {record.error ?? "Failed to extract dream symbols."}
                                  </div>
                                </div>
                              );
                            }
                            const data = record.data;
                            if (!data) return null;
                            return (
                              <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between">
                                  <div className="font-semibold text-slate-200">
                                    Dream extraction
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {data.relevance.nextNodeTitle
                                      ? `Relevant to: ${data.relevance.nextNodeTitle}`
                                      : "No next node detected"}
                                  </div>
                                </div>
                                {data.relevance.nextNodeId && data.relevance.nextNodeTitle ? (
                                  <button
                                    onClick={() =>
                                      router.push(`/chat?nodeId=${data.relevance.nextNodeId}`)
                                    }
                                    className="self-start rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/20"
                                  >
                                    Open next node chat
                                  </button>
                                ) : null}
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                    Scenes
                                  </div>
                                  <ol className="mt-2 list-decimal space-y-2 pl-5 text-slate-200">
                                    {data.scenes.map((scene) => (
                                      <li key={scene.idx}>
                                        <div>{scene.summary}</div>
                                        {scene.emotions?.length ? (
                                          <div className="mt-1 text-[11px] text-slate-400">
                                            Emotions: {scene.emotions.join(", ")}
                                          </div>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                    Symbols
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {data.symbols.map((symbol, symbolIndex) => {
                                      const symbolId = slugifySymbol(symbol.label);
                                      const meaning = record.personalMeanings?.[symbolId];
                                      const editorOpen =
                                        symbolEditorByMessage[entry.messageId] === symbolId;
                                      const draftKey = `${entry.messageId}:${symbolId}`;
                                      const draft = symbolDrafts[draftKey];
                                      return (
                                        <div
                                          key={`${symbol.label}-${symbolIndex}`}
                                          className="w-full"
                                        >
                                          <button
                                            onClick={() =>
                                              openSymbolEditor(entry.messageId, symbolId, meaning)
                                            }
                                            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-100 hover:border-sky-500/60"
                                          >
                                            {symbol.label}
                                            {symbol.category ? ` • ${symbol.category}` : ""}
                                          </button>
                                          <div className="mt-1 text-[11px] text-slate-400">
                                            “{symbol.contextSnippet}”
                                          </div>
                                          {symbol.emotionTags?.length ? (
                                            <div className="mt-1 text-[11px] text-slate-500">
                                              Emotions: {symbol.emotionTags.join(", ")}
                                            </div>
                                          ) : null}
                                          {editorOpen && (
                                            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                                              <label className="block text-[11px] uppercase tracking-wide text-slate-400">
                                                Personal meaning
                                              </label>
                                              <textarea
                                                value={draft?.personalMeaning ?? ""}
                                                onChange={(event) =>
                                                  setSymbolDrafts((prev) => ({
                                                    ...prev,
                                                    [draftKey]: {
                                                      personalMeaning: event.target.value,
                                                      valence: draft?.valence ?? "",
                                                    },
                                                  }))
                                                }
                                                className="mt-2 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                                                rows={3}
                                              />
                                              <label className="mt-3 block text-[11px] uppercase tracking-wide text-slate-400">
                                                Valence (-2..+2)
                                              </label>
                                              <input
                                                type="number"
                                                min={-2}
                                                max={2}
                                                step={1}
                                                value={draft?.valence ?? ""}
                                                onChange={(event) =>
                                                  setSymbolDrafts((prev) => ({
                                                    ...prev,
                                                    [draftKey]: {
                                                      personalMeaning: draft?.personalMeaning ?? "",
                                                      valence: event.target.value,
                                                    },
                                                  }))
                                                }
                                                className="mt-2 w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                              />
                                              <div className="mt-3 flex gap-2">
                                                <button
                                                  onClick={() =>
                                                    handleSaveSymbolMeaning(
                                                      entry.messageId,
                                                      symbolId
                                                    )
                                                  }
                                                  className="rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/20"
                                                >
                                                  Save meaning
                                                </button>
                                                <button
                                                  onClick={() =>
                                                    setSymbolEditorByMessage((prev) => ({
                                                      ...prev,
                                                      [entry.messageId]: null,
                                                    }))
                                                  }
                                                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                    Relevance to next step
                                  </div>
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-200">
                                    {data.relevance.hypotheses.map((item, idx) => (
                                      <li key={`${item}-${idx}`}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                    Clarifying question
                                  </div>
                                  <p className="mt-2 text-slate-200">
                                    {data.clarifyingQuestion}
                                  </p>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                  </div>
                ))}
                {isSending && (
                  <div className="max-w-2xl rounded-2xl bg-slate-900 px-4 py-3 text-sm text-slate-300">
                    Thinking…
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 bg-slate-950/80 px-6 py-4">
            {errorMessage && (
              <div className="mb-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {errorMessage}
              </div>
            )}
            <div className="flex items-end gap-3">
              <textarea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={selectedThread ? "Type your message…" : "Select a thread to start"}
                disabled={!selectedThread || isSending || isInitializing}
                className="min-h-[70px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                onClick={handleSend}
                disabled={!selectedThread || isSending || isInitializing || !composer.trim()}
                className="rounded-lg border border-sky-500/60 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
