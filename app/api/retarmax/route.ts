import { NextResponse } from "next/server";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

type Role = "user" | "assistant";

type ChatItem = {
  role: Role;
  content: string;
};

type RetarmaxRequest = {
  message: string;
  history?: ChatItem[];
  mode?: "docker" | "openai" | "mock";
};

async function readAgentsPolicy() {
  const path = `${process.cwd()}/AGENTS.md`;
  try {
    await access(path, constants.R_OK);
    return await readFile(path, "utf8");
  } catch {
    return "No AGENTS.md file found in repo root.";
  }
}

function runDockerAgent(prompt: string) {
  return new Promise<string>((resolve, reject) => {
    const image = process.env.RETARMAX_DOCKER_IMAGE ?? "ghcr.io/openai/codex-mini-agent:latest";
    const child = spawn("docker", ["run", "--rm", "--cpus=1", "-i", image], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Docker agent timed out after 30 seconds."));
    }, 30000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `Docker exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runOpenAI(prompt: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for openai mode.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.RETARMAX_MODEL ?? "gpt-5-nano",
      messages: [
        { role: "system", content: "Return markdown only." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message ?? "OpenAI call failed.");
  }

  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

function asMachineMarkdown(markdown: string) {
  const normalized = markdown.replace(/```/g, "\\`\\`\\`");
  return [
    "# machine-output",
    "",
    "```json",
    JSON.stringify({ type: "markdown", payload: normalized }, null, 2),
    "```",
  ].join("\n");
}

export async function POST(request: Request) {
  const body = (await request.json()) as RetarmaxRequest;
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const agentsPolicy = await readAgentsPolicy();
  const historyBlock = (body.history ?? [])
    .slice(-8)
    .map((item) => `- ${item.role}: ${item.content}`)
    .join("\n");

  const unifiedPrompt = [
    "You are Retarmax-Bot. Respond in markdown only.",
    "Follow AGENTS.md policy when applicable.",
    "",
    "## AGENTS.md",
    agentsPolicy,
    "",
    "## Recent history",
    historyBlock || "- none",
    "",
    "## User message",
    body.message,
  ].join("\n");

  try {
    const mode = body.mode ?? (process.env.RETARMAX_MODE as RetarmaxRequest["mode"]) ?? "mock";

    let humanMarkdown = "";
    if (mode === "docker") {
      humanMarkdown = await runDockerAgent(unifiedPrompt);
    } else if (mode === "openai") {
      humanMarkdown = await runOpenAI(unifiedPrompt);
    } else {
      humanMarkdown = [
        "# Retarmax-Bot (mock mode)",
        "",
        "I received your markdown instruction and prepared an Arduino action plan.",
        "",
        "- Mode: `mock`",
        "- Next: set `RETARMAX_MODE=docker` to run isolated one-CPU docker agent",
        "- Input accepted as markdown",
        "- Output returned as markdown for both human and machine readers",
      ].join("\n");
    }

    return NextResponse.json({
      humanMarkdown,
      machineMarkdown: asMachineMarkdown(humanMarkdown),
      mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retarmax-Bot failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
