"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { db } from "../db";
import { computeNodeStatuses } from "../journey";
import { ensureUserNodeStateRows, seedNodeDefinitionsFromUrl } from "../seed";
import type {
  AppSettings,
  ComputedNodeStatus,
  Message,
  NodeDefinition,
  Thread,
} from "../types";

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

interface ChatPageProps {
  nodeId: string | null;
}

export default function ChatPage({ nodeId }: ChatPageProps) {
  const [node, setNode] = useState<NodeDefinition | null>(null);
  const [status, setStatus] = useState<ComputedNodeStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [composer, setComposer] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const seededRef = useRef(false);

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
      if (!selectedThreadId && ordered.length) {
        setSelectedThreadId(ordered[0].id);
      }
      if (ordered.length === 0) {
        setSelectedThreadId(null);
      }
    };
    loadThreads();
    return () => {
      active = false;
    };
  }, [nodeId, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

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

  const handleSend = async () => {
    if (!node || !selectedThreadId || !composer.trim()) return;
    if (isSending) return;

    const messageText = composer.trim();
    setComposer("");
    setErrorMessage(null);

    const historySnapshot = messages.slice(-20).map((message) => ({
      role: message.role,
      content: message.content,
    }));

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
          history: historySnapshot,
          apiKey: settings?.openAiApiKey,
          model: settings?.modelChat,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send message.";
      setErrorMessage(message);
    } finally {
      setIsSending(false);
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
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center">
          <h1 className="text-2xl font-semibold">Missing node selection</h1>
          <p className="mt-2 text-sm text-slate-300">
            Please return to the journey map and open a node chat.
          </p>
          <Link
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700"
            href="/journey"
          >
            Back to journey
          </Link>
        </div>
      </main>
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
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      message.role === "user"
                        ? "ml-auto bg-sky-500/20 text-sky-100"
                        : "bg-slate-900 text-slate-100"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
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
                disabled={!selectedThread || isSending}
                className="min-h-[70px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                onClick={handleSend}
                disabled={!selectedThread || isSending || !composer.trim()}
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
