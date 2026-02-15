"use client";

import { useMemo, useState } from "react";

type OnboardingStep = {
  title: string;
  detail: string;
};

type BotResponse = {
  text: string;
  command: string;
};

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Plug in your Arduino",
    detail:
      "Connect your Arduino board with a USB cable. If this is your first time, install the board driver before continuing.",
  },
  {
    title: "Upload the starter sketch",
    detail:
      "Use Arduino IDE to upload a serial sketch that listens to text commands like LED_ON, LED_OFF, SERVO:90, and PING.",
  },
  {
    title: "Connect from the browser",
    detail:
      "Press Connect Arduino below and choose your serial port. Modern Chromium browsers support the Web Serial API.",
  },
  {
    title: "Control with MoltBot",
    detail:
      "Ask MoltBot with natural language (for example: turn led on, servo 120, or ping). MoltBot translates to serial commands.",
  },
];

const QUICK_ACTIONS = [
  "turn led on",
  "turn led off",
  "servo 90",
  "servo 150",
  "ping",
];

function parseMoltBotIntent(input: string): BotResponse {
  const normalized = input.trim().toLowerCase();

  if (normalized.includes("led") && (normalized.includes("on") || normalized.includes("start"))) {
    return { text: "LED turning on.", command: "LED_ON" };
  }

  if (normalized.includes("led") && (normalized.includes("off") || normalized.includes("stop"))) {
    return { text: "LED turning off.", command: "LED_OFF" };
  }

  if (normalized.includes("ping") || normalized.includes("status")) {
    return { text: "Checking board status.", command: "PING" };
  }

  const servoMatch = normalized.match(/servo\s*(?:to)?\s*(\d{1,3})/);
  if (servoMatch) {
    const rawAngle = Number(servoMatch[1]);
    const angle = Math.max(0, Math.min(180, rawAngle));
    return {
      text: `Moving servo to ${angle}°.`,
      command: `SERVO:${angle}`,
    };
  }

  return {
    text: "I did not understand. Try: turn led on, turn led off, servo 90, or ping.",
    command: "HELP",
  };
}

export default function Home() {
  const [stepIndex, setStepIndex] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [lastBotText, setLastBotText] = useState("MoltBot is ready. Start with: turn led on");
  const [lastCommand, setLastCommand] = useState("-");
  const [serialState, setSerialState] = useState("Disconnected");

  const progressPercent = useMemo(
    () => Math.round(((stepIndex + 1) / ONBOARDING_STEPS.length) * 100),
    [stepIndex]
  );

  const sendToArduino = async (command: string) => {
    if (typeof navigator === "undefined" || !("serial" in navigator)) {
      setSerialState("Web Serial not available in this browser");
      return;
    }

    try {
      setSerialState("Connecting...");
      const serialNavigator = navigator as Navigator & {
        serial: {
          requestPort: () => Promise<{
            open: (options: { baudRate: number }) => Promise<void>;
            writable: WritableStream<Uint8Array> | null;
          }>;
        };
      };

      const port = await serialNavigator.serial.requestPort();
      await port.open({ baudRate: 9600 });

      if (!port.writable) {
        setSerialState("Connected, but no writable stream");
        return;
      }

      const writer = port.writable.getWriter();
      const payload = new TextEncoder().encode(`${command}\n`);
      await writer.write(payload);
      writer.releaseLock();
      setSerialState(`Connected. Sent: ${command}`);
    } catch {
      setSerialState("Connection canceled or failed");
    }
  };

  const runCommand = async (input: string) => {
    const parsed = parseMoltBotIntent(input);
    setLastBotText(parsed.text);
    setLastCommand(parsed.command);
    if (parsed.command !== "HELP") {
      await sendToArduino(parsed.command);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">MoltBot + Arduino</p>
        <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Interactive control dashboard</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-300 md:text-base">
          This React + Node.js app helps you connect an Arduino board, run guided onboarding,
          and send natural-language instructions to MoltBot for hardware control.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-medium">Onboarding tutorial</h2>
            <span className="text-xs text-slate-400">{progressPercent}% complete</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <ol className="mt-4 space-y-3">
            {ONBOARDING_STEPS.map((step, index) => {
              const active = stepIndex === index;
              return (
                <li
                  key={step.title}
                  className={`rounded-lg border p-3 transition ${
                    active
                      ? "border-emerald-400/70 bg-emerald-400/10"
                      : "border-slate-800 bg-slate-950/50"
                  }`}
                >
                  <button
                    className="w-full text-left"
                    onClick={() => setStepIndex(index)}
                    type="button"
                  >
                    <p className="text-sm font-medium">{index + 1}. {step.title}</p>
                    <p className="mt-1 text-xs text-slate-300">{step.detail}</p>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => setStepIndex((value) => Math.max(0, value - 1))}
              disabled={stepIndex === 0}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
              onClick={() => setStepIndex((value) => Math.min(ONBOARDING_STEPS.length - 1, value + 1))}
              disabled={stepIndex === ONBOARDING_STEPS.length - 1}
            >
              Next
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-xl font-medium">MoltBot control console</h2>
          <p className="mt-1 text-sm text-slate-300">
            Type plain language commands and MoltBot converts them into Arduino serial instructions.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => runCommand(action)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm hover:bg-slate-700"
              >
                {action}
              </button>
            ))}
          </div>

          <label className="mt-4 block text-xs uppercase tracking-wide text-slate-400" htmlFor="commandInput">
            Command input
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="commandInput"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Example: servo 120"
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-emerald-400 focus:ring"
            />
            <button
              type="button"
              onClick={async () => {
                if (!prompt.trim()) return;
                await runCommand(prompt);
                setPrompt("");
              }}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              Send
            </button>
          </div>

          <div className="mt-5 space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm">
            <p><span className="text-slate-400">MoltBot:</span> {lastBotText}</p>
            <p><span className="text-slate-400">Last command:</span> {lastCommand}</p>
            <p><span className="text-slate-400">Serial status:</span> {serialState}</p>
          </div>
        </article>
      </section>
    </main>
  );
}
