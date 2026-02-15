"use client";

import { useMemo, useState } from "react";

type OnboardingStep = { title: string; detail: string };
type ViewMode = "human" | "machine";
type ChatMessage = {
  role: "user" | "assistant";
  humanMarkdown: string;
  machineMarkdown: string;
};

const ONBOARDING_STEPS: OnboardingStep[] = [
  { title: "Hardware", detail: "Connect Arduino by USB and verify power LED turns on." },
  { title: "Sketch", detail: "Upload serial sketch that accepts LED_ON, LED_OFF, PING, SERVO:<angle>." },
  { title: "Runtime", detail: "Set RETARMAX_MODE=docker to run one-CPU isolated agent container." },
  { title: "Chat", detail: "Use markdown prompts in this webapp and read human/machine outputs." },
];

const QUICK_ACTIONS = [
  "Turn led on and explain expected board behavior.",
  "Set servo to 90 and provide validation checklist.",
  "Give me a safe shutdown routine for Arduino sensors.",
];

export default function Home() {
  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("human");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const progress = useMemo(
    () => Math.round(((stepIndex + 1) / ONBOARDING_STEPS.length) * 100),
    [stepIndex]
  );

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      role: "user",
      humanMarkdown: trimmed,
      machineMarkdown: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);
    setIsSending(true);

    try {
      const response = await fetch("/api/retarmax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.slice(-8).map((item) => ({ role: item.role, content: item.humanMarkdown })),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Retarmax-Bot failed.");
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        humanMarkdown: String(payload.humanMarkdown ?? ""),
        machineMarkdown: String(payload.machineMarkdown ?? ""),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unknown error");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Retarmax-Bot</p>
        <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Arduino agent in isolated runtime</h1>
        <p className="mt-2 text-sm text-slate-300">
          Chat in markdown, run bot in one-CPU docker mode, and switch between human-readable and
          machine-readable output from the same response.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1fr_1.45fr]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Onboarding tutorial</h2>
            <span className="text-xs text-slate-400">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
          </div>
          <ol className="mt-4 space-y-2">
            {ONBOARDING_STEPS.map((step, index) => (
              <li key={step.title}>
                <button
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left ${
                    stepIndex === index
                      ? "border-emerald-400/70 bg-emerald-400/10"
                      : "border-slate-800 bg-slate-950/50"
                  }`}
                  onClick={() => setStepIndex(index)}
                >
                  <p className="text-sm font-medium">{index + 1}. {step.title}</p>
                  <p className="mt-1 text-xs text-slate-300">{step.detail}</p>
                </button>
              </li>
            ))}
          </ol>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Markdown chat</h2>
            <div className="flex rounded-lg border border-slate-700 p-1 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("human")}
                className={`rounded px-2 py-1 ${viewMode === "human" ? "bg-emerald-500 text-slate-950" : "text-slate-300"}`}
              >
                Human view
              </button>
              <button
                type="button"
                onClick={() => setViewMode("machine")}
                className={`rounded px-2 py-1 ${viewMode === "machine" ? "bg-emerald-500 text-slate-950" : "text-slate-300"}`}
              >
                Machine view
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-left text-xs hover:bg-slate-700"
                onClick={() => sendMessage(action)}
              >
                {action}
              </button>
            ))}
          </div>

          <div className="mt-4 h-[360px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-400">Start a chat. Input and output are markdown.</p>
            ) : (
              <ul className="space-y-3">
                {messages.map((message, index) => (
                  <li key={`${message.role}-${index}`} className="rounded border border-slate-800 bg-slate-900/70 p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">{message.role}</p>
                    <pre className="whitespace-pre-wrap text-xs text-slate-100">
                      {viewMode === "human" ? message.humanMarkdown : message.machineMarkdown}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="mt-4 block text-xs uppercase tracking-wide text-slate-400" htmlFor="chat-input">
            Markdown prompt
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none ring-emerald-400 focus:ring"
            placeholder="Example: Create a step-by-step plan to test LED and servo safely."
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={isSending}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
            {error && <p className="text-xs text-rose-300">{error}</p>}
          </div>
        </article>
      </section>
    </main>
  );
}
