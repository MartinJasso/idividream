import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import type { NodesFile } from "../../../types";

type ChatRequest = {
  nodeId: string;
  threadId: string;
  userMessage: string;
  nodeTitle?: string;
  promptTemplate?: string;
  status?: "locked" | "available" | "next" | "completed" | "unknown";
  unmetDependencies?: string[];
  currentNodeId?: string | null;
  currentSpiralOrder?: number | null;
  history?: { role: "user" | "assistant"; content: string }[];
  apiKey?: string;
  model?: string;
};

type NodeSnapshot = {
  title: string;
  prompt_template: string;
};

async function getNodeSnapshot(nodeId: string): Promise<NodeSnapshot | null> {
  try {
    const raw = await readFile("public/nodes.json", "utf-8");
    const data = JSON.parse(raw) as NodesFile;
    const node = data.nodes.find((item) => item.id === nodeId);
    if (!node) return null;
    return { title: node.title, prompt_template: node.prompt_template };
  } catch {
    return null;
  }
}

function buildStateBlock(payload: ChatRequest, nodeTitle?: string) {
  const unmet = payload.unmetDependencies?.length
    ? payload.unmetDependencies.join(", ")
    : "None";
  return [
    "Current state:",
    `- nodeId: ${payload.nodeId}`,
    `- nodeTitle: ${nodeTitle ?? payload.nodeTitle ?? "Unknown"}`,
    `- status: ${payload.status ?? "unknown"}`,
    `- unmetDependencies: ${unmet}`,
    `- currentNodeId: ${payload.currentNodeId ?? "unknown"}`,
    `- currentSpiralOrder: ${payload.currentSpiralOrder ?? "unknown"}`,
  ].join("\n");
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest;

  if (!payload?.nodeId || !payload?.threadId || !payload?.userMessage) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const apiKey =
    payload.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OpenAI API key." }, { status: 400 });
  }

  const nodeSnapshot = await getNodeSnapshot(payload.nodeId);
  const promptTemplate =
    payload.promptTemplate?.trim() ||
    nodeSnapshot?.prompt_template?.trim() ||
    "You are a helpful assistant.";

  const systemPrompt = [promptTemplate, "", buildStateBlock(payload, nodeSnapshot?.title)].join(
    "\n"
  );

  const history = (payload.history ?? [])
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-20);

  const body = {
    model: payload.model ?? "gpt-5-nano",
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: payload.userMessage },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const errorMessage = errorPayload?.error?.message ?? "OpenAI request failed.";
    return NextResponse.json({ error: errorMessage }, { status: response.status });
  }

  const data = await response.json();
  const assistant = data?.choices?.[0]?.message?.content ?? "";

  return NextResponse.json({ assistant });
}
