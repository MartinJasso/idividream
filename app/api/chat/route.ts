import { NextResponse } from "next/server";
import { buildChatContext } from "../../../src/lib/server/contextBuilder";
import { normalizeModel } from "../../../model";

type ChatRequest = {
  nodeId: string;
  threadId: string;
  userMessage: string;
  history?: { role: "user" | "assistant"; content: string }[];
  threadSummary?: { summary: string; keyMotifs: string[] } | null;
  status?: "locked" | "available" | "next" | "completed" | "unknown";
  unmetDependencies?: string[];
  currentNodeId?: string | null;
  currentSpiralOrder?: number | null;
  nextNode?: { id: string; title: string } | null;
  apiKey?: string;
  model?: string;
};

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

  const context = await buildChatContext({
    nodeId: payload.nodeId,
    threadId: payload.threadId,
    userMessage: payload.userMessage,
    history: payload.history ?? [],
    threadSummary: payload.threadSummary ?? null,
    status: payload.status,
    unmetDependencies: payload.unmetDependencies,
    currentNodeId: payload.currentNodeId ?? null,
    currentSpiralOrder: payload.currentSpiralOrder ?? null,
    nextNode: payload.nextNode ?? null,
  });

  const body = {
    model: normalizeModel(payload.model),
    messages: [
      { role: "system", content: context.system },
      ...context.messages.map((item) => ({ role: item.role, content: item.content })),
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
